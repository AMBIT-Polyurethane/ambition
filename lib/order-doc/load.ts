import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Branch, Order } from "@/lib/types";
import { docState, type DocCompany, type DocItem, type OrderDoc } from "@/lib/order-doc/types";
import { foamOf, lastPricesFrom, type LastPrices, type LotPick, type PricePart } from "@/lib/order-doc/loads";

/**
 * Brand and lot for each line of an order, by order item. Only AMBIT staff can read these (row-level
 * security returns nothing to anyone else). Cancelled picks are left out.
 */
export async function orderPicks(supabase: SupabaseClient, orderId: string): Promise<Map<number, LotPick[]>> {
  const { data, error } = await supabase
    .from("inventory_lines")
    .select("id, order_item_id, sku, qty, state, lot_id, lot_no, lot:inventory_lots(exp, use_by)")
    .eq("order_id", orderId)
    .neq("state", "cancelled")
    .order("id");
  const out = new Map<number, LotPick[]>();
  if (error || !data) return out;
  type Row = { id: number; order_item_id: number; sku: string; qty: number; state: string; lot_id: number | null; lot_no: string | null; lot: { exp: string | null; use_by: string | null } | null };
  for (const r of data as unknown as Row[]) {
    const p: LotPick = { id: r.id, qty: Number(r.qty), sku: r.sku, lot_id: r.lot_id, lot_no: r.lot_no, exp: r.lot?.exp ?? null, use_by: r.lot?.use_by ?? null, state: r.state };
    out.set(r.order_item_id, [...(out.get(r.order_item_id) ?? []), p]);
  }
  return out;
}

/** Only lines filled from lots (or from another brand) are worth showing. */
export const showsPicks = (itemSku: string, picks: LotPick[] | undefined) =>
  Boolean(picks?.length && picks.some((p) => p.lot_no !== null || p.sku.toUpperCase() !== itemSku.toUpperCase()));

/** Loads an order the signed-in person is allowed to see (row-level security decides). */
export async function loadOrderDoc(supabase: SupabaseClient, id: string, opts: { picks?: boolean } = {}): Promise<OrderDoc | null> {
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) return null;
  const [{ data: items }, { data: branch }, { data: company }] = await Promise.all([
    supabase.from("order_items").select("id, sku, name, unit, qty, unit_price, customer_priced, line_total, price_parts, product:products!order_items_product_id_fkey(category_id)").eq("order_id", id).order("id"),
    order.branch_id
      ? supabase.from("branches").select("*").eq("id", order.branch_id).maybeSingle<Branch>()
      : Promise.resolve({ data: null }),
    order.company_id
      ? supabase.from("companies").select("contact_name, phone, email, bill_address").eq("id", order.company_id).maybeSingle<DocCompany>()
      : Promise.resolve({ data: null }),
  ]);
  const picks = opts.picks ? await orderPicks(supabase, id) : null;
  return {
    order,
    items: ((items ?? []) as unknown as (DocItem & { product?: { category_id: string | null } | null })[]).map(({ product, ...i }) => {
      const p = picks?.get(Number(i.id));
      return { ...i, foam: foamOf(i, product?.category_id), ...(p && showsPicks(i.sku, p) ? { picks: p } : {}) };
    }),
    branch: (branch as Branch | null) ?? null,
    company: (company as DocCompany | null) ?? null,
    state: docState(order),
  };
}

/** The same thing, from the database's approval-link functions (no sign-in). */
export function docFromJson(json: unknown): OrderDoc | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { order?: Order; items?: DocItem[]; branch?: Branch | null; company?: DocCompany | null; state?: OrderDoc["state"] };
  if (!j.order) return null;
  return {
    order: j.order,
    items: j.items ?? [],
    branch: j.branch ?? null,
    company: j.company ?? null,
    state: j.state ?? docState(j.order),
  };
}

/**
 * Order desk: the prices this customer was invoiced on their orders placed in the last 30 days (newest first),
 * so the price step can start from them. Null when there are none.
 */
export async function customerLastPrices(supabase: SupabaseClient, companyId: string, orderId: string): Promise<LastPrices | null> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, priced_at")
    .eq("company_id", companyId)
    .neq("id", orderId)
    .neq("status", "cancelled")
    .not("priced_at", "is", null)
    .gte("created_at", since)
    .order("priced_at", { ascending: false })
    .limit(25);
  if (!orders?.length) return null;
  const { data: items } = await supabase
    .from("order_items")
    .select("id, order_id, sku, name, unit, qty, unit_price, price_parts, product:products!order_items_product_id_fkey(category_id)")
    .in("order_id", orders.map((o) => o.id));
  type Row = { id: number; order_id: string; sku: string; name: string; unit: string; qty: number; unit_price: number | null; price_parts: PricePart[] | null; product: { category_id: string | null } | null };
  const rows = ((items ?? []) as unknown as Row[]).map(({ product, ...i }) => ({ ...i, foam: foamOf(i, product?.category_id) }));
  const last = lastPricesFrom(orders as { id: string; order_no: number; priced_at: string | null }[], rows);
  return Object.keys(last.sku).length || Object.keys(last.iso).length ? last : null;
}
