import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// What a location carries = the items on its inventory spreadsheet (COUNT SHEET and FOAM LOTS), plus the
// catalog item a stocked brand sells as (ISO-COVESTRO on the sheet -> "ISO A-Side" in the catalog).
// Ordering only offers a location's own items. A location with no linked spreadsheet has no list (null),
// and then the whole catalog shows, as before.

export type StockRow = { product_id: string; on_hand: number | null; pending: number | null; net: number | null; reorder_point: number | null; label: string | null };

/** The location's live stock rows (numbers for staff, In / Low / Out for customers). Empty = no linked spreadsheet. */
export async function stockRows(db: SupabaseClient, branch: string): Promise<StockRow[]> {
  const { data, error } = await db.rpc("stock_for", { p_branch: branch });
  if (error || !data) return [];
  return data as StockRow[];
}

/** The product ids a location carries, or null when it has no linked spreadsheet (everything shows). */
export async function carriedAt(db: SupabaseClient, branch: string | null | undefined): Promise<Set<string> | null> {
  if (!branch) return null;
  const rows = await stockRows(db, branch);
  return rows.length ? new Set(rows.map((r) => r.product_id)) : null;
}

/** carriedAt for several locations at once: { branch: [product ids] } (locations with no spreadsheet are left out). */
export async function carriedByBranch(db: SupabaseClient, branches: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  await Promise.all(
    branches.map(async (b) => {
      const set = await carriedAt(db, b);
      if (set) out[b] = [...set];
    }),
  );
  return out;
}
