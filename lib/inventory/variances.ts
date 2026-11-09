import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/order-desk";
import { todayCentral } from "@/lib/sale";
import { every } from "@/lib/inventory/pages";

// The variance report: every item (spray foam lot by lot) whose most recent count didn't match what the
// app had, where the difference hasn't been approved (still waiting, or an admin said no). Approved
// differences are already in stock, so they're not variances any more.

export type VarianceRow = {
  countId: number;
  kind: "spot" | "reconcile";
  status: "submitted" | "rejected";
  branch: string;
  productId: string;
  sku: string;
  name: string;
  unit: string | null;
  lotNo: string | null;
  /** The day it was counted (Central time). */
  day: string;
  countedBy: string | null;
  system: number;
  counted: number;
  diff: number;
  /** What was counted before an admin fixed it. */
  firstQty: number | null;
  fixedBy: string | null;
};

type LineRow = {
  id: number;
  product_id: string;
  sku: string;
  name: string | null;
  unit: string | null;
  lot_id: number | null;
  lot_no: string | null;
  system_qty: number | null;
  counted_qty: number | null;
  counted_at: string | null;
  counted_by_name: string | null;
  first_qty?: number | null;
  fixed_by_name?: string | null;
  cnt: { id: number; branch_id: string; kind: "spot" | "reconcile"; day: string | null; status: string; submitted_at: string | null };
};

const centralDay = (iso: string | null) => (iso ? todayCentral(new Date(iso)) : null);

/** Items with a variance at these locations, worst (largest difference) first within each location. */
export async function loadVariances(db: SupabaseClient, branches: string[]): Promise<VarianceRow[]> {
  if (!branches.length) return [];
  const since = `${addDays(todayCentral(), -400)}T00:00:00Z`;
  // A count still being counted (open) doesn't count yet.
  const rows = await every<LineRow>((from, to) =>
    db
      .from("inventory_count_lines")
      .select(
        "id, product_id, sku, name, unit, lot_id, lot_no, system_qty, counted_qty, counted_at, counted_by_name, first_qty, fixed_by_name, cnt:inventory_counts!inner(id, branch_id, kind, day, status, submitted_at)",
      )
      .in("cnt.branch_id", branches)
      .in("cnt.status", ["matched", "submitted", "approved", "rejected"])
      .not("counted_qty", "is", null)
      .gte("counted_at", since)
      .order("counted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );

  const seen = new Set<string>();
  const out: VarianceRow[] = [];
  for (const l of rows) {
    const key = `${l.cnt.branch_id}|${l.product_id}|${l.lot_id ?? l.lot_no ?? ""}`;
    if (seen.has(key)) continue; // only the most recent count of each item (or lot) matters
    seen.add(key);
    const system = Number(l.system_qty ?? 0);
    const counted = Number(l.counted_qty);
    const diff = Math.round((counted - system) * 100) / 100;
    if (Math.abs(diff) < 0.005) continue;
    if (l.cnt.status !== "submitted" && l.cnt.status !== "rejected") continue;
    out.push({
      countId: l.cnt.id,
      kind: l.cnt.kind,
      status: l.cnt.status,
      branch: l.cnt.branch_id,
      productId: l.product_id,
      sku: l.sku,
      name: l.name ?? l.sku,
      unit: l.unit,
      lotNo: l.lot_no,
      day: l.cnt.day ?? centralDay(l.counted_at) ?? centralDay(l.cnt.submitted_at) ?? "",
      countedBy: l.counted_by_name,
      system,
      counted,
      diff,
      firstQty: l.first_qty === null || l.first_qty === undefined ? null : Number(l.first_qty),
      fixedBy: l.fixed_by_name ?? null,
    });
  }
  return out.sort((a, b) => a.branch.localeCompare(b.branch) || Math.abs(b.diff) - Math.abs(a.diff) || a.sku.localeCompare(b.sku));
}
