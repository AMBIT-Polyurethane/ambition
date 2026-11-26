import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Before a location's spreadsheet is retired (0120): what still needs a look. None of it blocks retiring;
// it's the clean-up list for the warehouse manager.

export type RetireCheck = {
  negItems: { sku: string; qty: number }[];
  negLots: { sku: string; lot: string; qty: number }[];
  expired: { sku: string; lot: string; qty: number; useBy: string }[];
  /** Taken off the spreadsheet's FOAM LOTS but still holding drums in the app (hidden from orders). */
  offList: { sku: string; lot: string; qty: number }[];
  blanks: number;
  noRop: number;
  items: number;
};

const n = (v: unknown) => Number(v ?? 0);

export async function retireCheck(db: SupabaseClient, branch: string): Promise<RetireCheck> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [{ data: inv }, { data: lots }] = await Promise.all([
    db.from("inventory").select("sku, on_hand, reorder_point, on_sheet").eq("branch_id", branch).range(0, 4999),
    db.from("inventory_lots").select("sku, lot_no, remaining, in_unsynced, adj_unsynced, use_by, exp, on_sheet, add_to_sheet").eq("branch_id", branch).range(0, 4999),
  ]);
  type I = { sku: string; on_hand: number | null; reorder_point: number | null; on_sheet: boolean };
  type L = { sku: string; lot_no: string | null; remaining: number; in_unsynced: number; adj_unsynced: number; use_by: string | null; exp: string | null; on_sheet: boolean; add_to_sheet: boolean };
  const items = ((inv ?? []) as I[]).filter((i) => i.on_sheet);
  const all = (lots ?? []) as L[];
  const qty = (l: L) => Math.round((n(l.remaining) + n(l.in_unsynced) + n(l.adj_unsynced)) * 100) / 100;
  const listed = all.filter((l) => l.on_sheet || l.add_to_sheet);
  return {
    items: items.length,
    negItems: items.filter((i) => i.on_hand !== null && n(i.on_hand) < 0).map((i) => ({ sku: i.sku, qty: n(i.on_hand) })),
    negLots: listed.filter((l) => qty(l) < 0).map((l) => ({ sku: l.sku, lot: l.lot_no || "(no lot #)", qty: qty(l) })),
    expired: listed
      .filter((l) => qty(l) > 0 && (l.use_by ?? l.exp) && (l.use_by ?? l.exp)! < today)
      .map((l) => ({ sku: l.sku, lot: l.lot_no || "(no lot #)", qty: qty(l), useBy: (l.use_by ?? l.exp)! })),
    offList: all.filter((l) => !l.on_sheet && !l.add_to_sheet && qty(l) !== 0).map((l) => ({ sku: l.sku, lot: l.lot_no || "(no lot #)", qty: qty(l) })),
    blanks: items.filter((i) => i.on_hand === null).length,
    noRop: items.filter((i) => i.reorder_point === null).length,
  };
}
