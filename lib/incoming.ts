import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockItem } from "@/components/incoming-forms";

/** What a location stocks (its COUNT SHEET items), with the ones tracked by lot marked. */
export async function stockItems(db: SupabaseClient, branch: string): Promise<StockItem[]> {
  const [{ data: inv }, { data: lots }] = await Promise.all([
    db.from("inventory").select("product_id, sku, sheet_row, product:products(name, unit)").eq("branch_id", branch).eq("on_sheet", true).order("sheet_row"),
    db.from("inventory_lots").select("product_id").eq("branch_id", branch),
  ]);
  const lotted = new Set(((lots ?? []) as { product_id: string }[]).map((l) => l.product_id));
  return ((inv ?? []) as unknown as { product_id: string; sku: string; product: { name: string; unit: string } | null }[]).map((r) => ({
    product_id: r.product_id,
    sku: r.sku,
    name: r.product?.name ?? r.sku,
    unit: r.product?.unit ?? "each",
    lots: lotted.has(r.product_id),
  }));
}

/** Vendors typed before, for the "From" suggestions. */
export async function vendorNames(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("inbound_deliveries").select("vendor").order("created_at", { ascending: false }).limit(200);
  return [...new Set(((data ?? []) as { vendor: string }[]).map((d) => d.vendor))].slice(0, 30);
}
