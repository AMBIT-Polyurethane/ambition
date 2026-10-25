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
  last_summary: { from_sheet?: number; to_sheet?: number; new_products?: string[]; lines_added?: number; sheet_closed?: number; conflicts?: number; items?: number; full?: boolean; duplicates?: string[] } | null;
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
  const [{ data: rows }, { data: levels }] = await Promise.all([
    supabase
      .from("inventory")
      .select("product_id, sku, on_hand, reorder_point, max_qty, last_counted, counted_by, sheet_row, product:products(name, category_id, unit)")
      .eq("branch_id", branch)
      .eq("on_sheet", true)
      .order("sheet_row")
      .range(0, 4999),
    supabase.rpc("stock_for", { p_branch: branch }),
  ]);
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
  return ((rows ?? []) as unknown as Row[]).map((r) => {
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
