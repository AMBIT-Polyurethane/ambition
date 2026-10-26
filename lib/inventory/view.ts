import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// What the Inventory screens show (read with the signed-in person's own access).

export type SheetInfo = {
  branch_id: string;
  share_url: string;
  file_name: string | null;
  enabled: boolean;
  connected_at: string | null;
  last_sync_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_summary: { from_sheet?: number; to_sheet?: number; new_products?: string[]; lines_added?: number; sheet_closed?: number; conflicts?: number; items?: number; full?: boolean; duplicates?: string[]; lots?: number; lot_issues?: string[] } | null;
};

export type StockRow = {
  product_id: string;
  sku: string;
  name: string;
  category_id: string | null;
  unit: string;
  on_hand: number | null;
  pending: number;
  net: number | null;
  reorder_point: number | null;
  max_qty: number | null;
  last_counted: string | null;
  counted_by: string | null;
  label: "in" | "low" | "out" | null;
  sheet_row: number | null;
  /** Counted by lot (spray foam on the FOAM LOTS tab): its lots, soonest to go first. */
  lots?: LotView[];
};

export type LotView = {
  id: number;
  lot_no: string;
  mfg: string | null;
  exp: string | null;
  use_by: string | null;
  remaining: number;
  held: number;
  available: number;
  expired: boolean;
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function inventorySheets(supabase: SupabaseClient): Promise<SheetInfo[]> {
  const { data, error } = await supabase
    .from("inventory_sheets")
    .select("branch_id, share_url, file_name, enabled, connected_at, last_sync_at, last_ok_at, last_error, last_summary")
    .order("branch_id");
  if (error) return [];
  return (data ?? []) as SheetInfo[];
}

export async function branchStock(supabase: SupabaseClient, branch: string): Promise<StockRow[]> {
  const [{ data: rows }, { data: levels }, { data: lotRows }, { data: pickRows }] = await Promise.all([
    supabase
      .from("inventory")
      .select("product_id, sku, on_hand, reorder_point, max_qty, last_counted, counted_by, sheet_row, product:products(name, category_id, unit)")
      .eq("branch_id", branch)
      .eq("on_sheet", true)
      .order("sheet_row")
      .range(0, 4999),
    supabase.rpc("stock_for", { p_branch: branch }),
    supabase.from("inventory_lots").select("id, product_id, lot_no, mfg, exp, use_by, remaining, sheet_pending, on_sheet, sheet_row").eq("branch_id", branch).range(0, 4999),
    supabase.from("inventory_lines").select("lot_id, qty").eq("branch_id", branch).eq("state", "reserved").not("lot_id", "is", null).range(0, 9999),
  ]);
  // Lots per product (only products counted by lot have any).
  const held = new Map<number, number>();
  for (const p of (pickRows ?? []) as { lot_id: number; qty: number }[]) held.set(p.lot_id, (held.get(p.lot_id) ?? 0) + Number(p.qty));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  type LotRow = { id: number; product_id: string; lot_no: string; mfg: string | null; exp: string | null; use_by: string | null; remaining: number; sheet_pending: number; on_sheet: boolean; sheet_row: number | null };
  const lotsOf = new Map<string, LotView[]>();
  const lotOrder = new Map<string, number>(); // spray foam first, in FOAM LOTS order
  for (const l of (lotRows ?? []) as LotRow[]) {
    if (!lotsOf.has(l.product_id)) lotsOf.set(l.product_id, []);
    lotOrder.set(l.product_id, Math.min(lotOrder.get(l.product_id) ?? 1e9, l.sheet_row ?? 1e8));
    if (!l.on_sheet) continue;
    const h = (held.get(l.id) ?? 0) + Number(l.sheet_pending);
    lotsOf.get(l.product_id)!.push({
      id: l.id,
      lot_no: l.lot_no,
      mfg: l.mfg,
      exp: l.exp,
      use_by: l.use_by,
      remaining: Number(l.remaining),
      held: h,
      available: Number(l.remaining) - h,
      expired: Boolean(l.use_by && l.use_by < today),
    });
  }
  for (const list of lotsOf.values()) list.sort((a, z) => (a.use_by ?? "9999").localeCompare(z.use_by ?? "9999") || a.lot_no.localeCompare(z.lot_no));
  const lv = new Map(((levels ?? []) as { product_id: string; pending: number | null; net: number | null; label: string | null }[]).map((l) => [l.product_id, l]));
  type Row = {
    product_id: string;
    sku: string;
    on_hand: number | null;
    reorder_point: number | null;
    max_qty: number | null;
    last_counted: string | null;
    counted_by: string | null;
    sheet_row: number | null;
    product: { name: string; category_id: string | null; unit: string } | null;
  };
  const ordered = ((rows ?? []) as unknown as Row[]).sort((a, z) => (lotOrder.get(a.product_id) ?? 2e9) - (lotOrder.get(z.product_id) ?? 2e9));
  return ordered.map((r) => {
    const l = lv.get(r.product_id);
    return {
      product_id: r.product_id,
      sku: r.sku,
      name: r.product?.name ?? r.sku,
      category_id: r.product?.category_id ?? null,
      unit: r.product?.unit ?? "each",
      on_hand: n(r.on_hand),
      pending: n(l?.pending) ?? 0,
      net: n(l?.net),
      reorder_point: n(r.reorder_point),
      max_qty: n(r.max_qty),
      last_counted: r.last_counted,
      counted_by: r.counted_by,
      label: l?.label === "in" || l?.label === "low" || l?.label === "out" ? l.label : null,
      sheet_row: r.sheet_row,
      ...(lotsOf.has(r.product_id) ? { lots: lotsOf.get(r.product_id) } : {}),
    };
  });
}

/** At or under the reorder point (only items that have one set on the sheet). */
export const needsReorder = (r: Pick<StockRow, "net" | "reorder_point">) => r.reorder_point !== null && r.net !== null && r.net <= r.reorder_point;

/** For the Home badge: how many items at the person's location need reordering. */
export async function reorderCount(supabase: SupabaseClient, branch: string | null | undefined): Promise<number> {
  if (!branch) return 0;
  const { data, error } = await supabase.rpc("stock_for", { p_branch: branch });
  if (error || !data) return 0;
  return (data as { net: number | null; reorder_point: number | null }[]).filter((r) => needsReorder({ net: n(r.net), reorder_point: n(r.reorder_point) })).length;
}

/** "2 min ago" */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}
