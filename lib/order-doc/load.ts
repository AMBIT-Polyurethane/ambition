import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Branch, Order } from "@/lib/types";
import { docState, type DocCompany, type DocItem, type OrderDoc } from "@/lib/order-doc/types";

/** Loads an order the signed-in person is allowed to see (row-level security decides). */
export async function loadOrderDoc(supabase: SupabaseClient, id: string): Promise<OrderDoc | null> {
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) return null;
  const [{ data: items }, { data: branch }, { data: company }] = await Promise.all([
    supabase.from("order_items").select("id, sku, name, unit, qty, unit_price, customer_priced, line_total").eq("order_id", id).order("id"),
    order.branch_id
      ? supabase.from("branches").select("*").eq("id", order.branch_id).maybeSingle<Branch>()
      : Promise.resolve({ data: null }),
    order.company_id
      ? supabase.from("companies").select("contact_name, phone, email, bill_address").eq("id", order.company_id).maybeSingle<DocCompany>()
      : Promise.resolve({ data: null }),
  ]);
  return {
    order,
    items: (items ?? []) as DocItem[],
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
