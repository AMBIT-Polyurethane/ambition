import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockItem } from "@/components/incoming-forms";
import type { SendItem } from "@/components/inventory/transfer-form";
import { branchStock } from "@/lib/inventory/view";
import { every } from "@/lib/inventory/pages";

/** What a location stocks (its COUNT SHEET items): spray foam counted by lot, and items that need a lot / batch # and expiration. */
export async function stockItems(db: SupabaseClient, branch: string): Promise<StockItem[]> {
  const [{ data: inv }, { data: lots }] = await Promise.all([
    db.from("inventory").select("product_id, sku, sheet_row, product:products(name, unit, track_lots, shelf_life_months)").eq("branch_id", branch).eq("on_sheet", true).order("sheet_row"),
    db.from("inventory_lots").select("product_id").eq("branch_id", branch),
  ]);
  const lotted = new Set(((lots ?? []) as { product_id: string }[]).map((l) => l.product_id));
  type Row = { product_id: string; sku: string; product: { name: string; unit: string; track_lots?: boolean | null; shelf_life_months?: number | null } | null };
  return ((inv ?? []) as unknown as Row[]).map((r) => ({
    product_id: r.product_id,
    sku: r.sku,
    name: r.product?.name ?? r.sku,
    unit: r.product?.unit ?? "each",
    lots: lotted.has(r.product_id),
    track: !lotted.has(r.product_id) && Boolean(r.product?.track_lots),
    shelfLife: r.product?.shelf_life_months ?? null,
  }));
}

/** Vendors typed before, for the "From" suggestions. */
export async function vendorNames(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("inbound_deliveries").select("vendor").order("created_at", { ascending: false }).limit(200);
  return [...new Set(((data ?? []) as { vendor: string }[]).map((d) => d.vendor))].slice(0, 30);
}

/** What a location can send to another (its stock, less what's held for orders), lots for spray foam. */
export async function sendableItems(db: SupabaseClient, branch: string): Promise<SendItem[]> {
  const rows = await branchStock(db, branch);
  return rows
    .map((r) => ({
      product_id: r.product_id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      lots: Boolean(r.lots),
      available: Math.max(0, r.net ?? r.on_hand ?? 0),
      lotList: (r.lots ?? []).map((l) => ({ id: l.id, lot_no: l.lot_no, available: Math.max(0, l.available), use_by: l.use_by, expired: l.expired })),
    }))
    .filter((i) => (i.lots ? i.lotList.some((l) => l.available > 0) : i.available > 0));
}

/** For each location: the items it stocks (on its COUNT SHEET or counted by lot there). */
export async function stockedAt(db: SupabaseClient, branches: string[]): Promise<Record<string, string[]>> {
  const [inv, lots] = await Promise.all([
    every<{ branch_id: string; product_id: string }>((x, y) => db.from("inventory").select("branch_id, product_id").in("branch_id", branches).eq("on_sheet", true).order("branch_id").order("product_id").range(x, y)),
    every<{ branch_id: string; product_id: string }>((x, y) => db.from("inventory_lots").select("branch_id, product_id").in("branch_id", branches).order("id").range(x, y)),
  ]);
  const out: Record<string, Set<string>> = {};
  for (const r of [...inv, ...lots]) {
    (out[r.branch_id] ??= new Set()).add(r.product_id);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/** An earlier Receiving Report at the same location with the same BOL # (waiting for approval or received). */
export type BolMatch = {
  id: number;
  status: "submitted" | "received";
  at: string | null; // when it was sent / received
  by: string | null;
  lines: string; // "28 AMB-TITE-20-W, 2 GUN-PART-X"
};

/** BOL #s as people type them: case, spaces and a leading "#" don't matter. */
export const bolKey = (bol: string | null | undefined) => String(bol ?? "").toUpperCase().replace(/^#/, "").replace(/\s+/g, "");

/**
 * Other reports at this location on the same BOL #, oldest first. A second report on one BOL is either the
 * same truck sent twice (a mistake) or another load on the same ticket (the plant's shuttle loads all carry
 * one transfer order #), so the person receiving has to say which.
 */
export async function sameBol(db: SupabaseClient, branch: string, bol: string, except?: number | null): Promise<BolMatch[]> {
  const key = bolKey(bol);
  if (key.length < 3) return [];
  // Narrow on the database (contains the key's longest run of letters and digits), then compare exactly here.
  const run = (key.match(/[A-Z0-9]+/g) ?? []).sort((a, b) => b.length - a.length)[0] ?? key;
  const { data } = await db
    .from("inbound_deliveries")
    .select("id, status, bol_no, submitted_at, received_at, submitted_by_name, received_by_name, created_at")
    .eq("branch_id", branch)
    .in("status", ["submitted", "received"])
    .ilike("bol_no", `%${run}%`)
    .order("created_at")
    .limit(50);
  type Row = { id: number; status: "submitted" | "received"; bol_no: string | null; submitted_at: string | null; received_at: string | null; submitted_by_name: string | null; received_by_name: string | null; created_at: string };
  const hits = ((data ?? []) as Row[]).filter((r) => r.id !== except && bolKey(r.bol_no) === key);
  if (!hits.length) return [];
  const { data: lineRows } = await db.from("inbound_lines").select("delivery_id, sku, qty, received_qty").in("delivery_id", hits.map((h) => h.id)).order("id");
  const linesOf = new Map<number, string[]>();
  for (const l of (lineRows ?? []) as { delivery_id: number; sku: string; qty: number; received_qty: number | null }[]) {
    const n = Number(l.received_qty ?? l.qty);
    (linesOf.get(l.delivery_id) ?? linesOf.set(l.delivery_id, []).get(l.delivery_id)!).push(`${Number.isInteger(n) ? n : n.toFixed(2)} ${l.sku}`);
  }
  return hits.map((h) => ({
    id: h.id,
    status: h.status,
    at: h.submitted_at ?? h.received_at ?? h.created_at,
    by: h.received_by_name ?? h.submitted_by_name,
    lines: (linesOf.get(h.id) ?? []).join(", "),
  }));
}
