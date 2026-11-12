import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carriedAt } from "@/lib/inventory/carried";
import { saleOn } from "@/lib/sale";

// Popular items a customer can add to their order from the approval email (0065): spray foam (at account pricing),
// and everything else only if it has a list price; only what the order's location carries; never Alpha products.

export type AddonPick = { id: string; sku: string; name: string; unit: string; price: number | null; account: boolean; foam: boolean; n: number };

type P = {
  id: string; sku: string; name: string; unit: string; list_price: number | null; sale_price: number | null; sale_ends: string | null;
  customer_priced: boolean | null; category_id: string | null; admin_only?: boolean | null; active: boolean; stock_of: string | null;
  category: { customer_priced: boolean | null } | null;
};

/** The location's most ordered items (last 90 days) that a customer may add, skipping SKUs already on the order. */
export async function popularAddons(db: SupabaseClient, branch: string | null, excludeSkus: string[], limit = 10): Promise<AddonPick[]> {
  if (!branch) return [];
  const { data: sold } = await db.rpc("sold_by_product", { p_branch: branch, p_days: 90 });
  const ranked = ((sold ?? []) as { product_id: string; orders: number }[]).sort((a, b) => b.orders - a.orders);
  const skip = new Set(excludeSkus.map((x) => x.toUpperCase()));
  if (!ranked.length) return [];
  const ids = ranked.slice(0, 60).map((r) => r.product_id);
  const [{ data: prods }, here] = await Promise.all([
    db.from("products").select("id, sku, name, unit, list_price, sale_price, sale_ends, customer_priced, category_id, admin_only, active, stock_of, category:categories(customer_priced)").in("id", ids),
    carriedAt(db, branch),
  ]);
  const byId = new Map(((prods ?? []) as unknown as P[]).map((p) => [p.id, p]));
  const out: AddonPick[] = [];
  for (const r of ranked) {
    const p = byId.get(r.product_id);
    if (!p || !p.active || p.admin_only || p.stock_of || skip.has(p.sku.toUpperCase()) || (here && !here.has(p.id))) continue;
    const onSale = saleOn(p.sale_price, p.sale_ends);
    const price = onSale ? Number(p.sale_price) : p.list_price === null ? null : Number(p.list_price);
    const foam = p.category_id === "ambit-foam";
    if (!foam && !(price && price > 0)) continue;
    const account = Boolean(p.customer_priced ?? p.category?.customer_priced) && !onSale;
    out.push({ id: p.id, sku: p.sku, name: p.name, unit: p.unit, price: account ? null : price, account, foam, n: r.orders });
    if (out.length >= limit) break;
  }
  return out;
}
