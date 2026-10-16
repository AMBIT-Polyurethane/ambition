"use server";

import { revalidatePath } from "next/cache";
import { getSession, isEmployee } from "@/lib/session";
import { sendOrderEmail } from "@/lib/order-send";

export type PlaceOrderInput = {
  items: Record<string, number>;
  delivery: "pickup" | "jobsite" | "dropship";
  branchId: string;
  address: string;
  po: string;
  neededBy: string;
  notes: string;
  companyId: string; // employees only; "__other" = not in list
  customerName: string;
};

export type PlaceOrderResult = { ok: true; id: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const s = await getSession();
  if (!s || !s.profile) return { ok: false, error: "Please sign in again." };
  const emp = isEmployee(s.profile);

  const items = Object.entries(input.items ?? {})
    .filter(([id, q]) => UUID.test(id) && Number(q) > 0)
    .map(([product_id, qty]) => ({ product_id, qty: Math.min(Number(qty), 100000) }));
  if (items.length === 0) return { ok: false, error: "Your order is empty." };

  if (emp && !input.companyId) return { ok: false, error: "Choose who this order is for." };
  if (emp && input.companyId === "__other" && !input.customerName.trim()) {
    return { ok: false, error: "Type the customer's name." };
  }
  const neededBy = /^\d{4}-\d{2}-\d{2}$/.test(input.neededBy) ? input.neededBy : null;

  const { data: id, error } = await s.supabase.rpc("place_order", {
    p_items: items,
    p_delivery_method: input.delivery,
    p_branch_id: input.delivery === "pickup" ? input.branchId || null : null,
    p_ship_address: input.delivery === "pickup" ? null : input.address,
    p_po_number: input.po || null,
    p_needed_by: neededBy,
    p_notes: input.notes || null,
    p_company_id: emp && UUID.test(input.companyId) ? input.companyId : null,
    p_customer_name: emp && input.companyId === "__other" ? input.customerName : null,
  });
  if (error || !id) return { ok: false, error: error?.message ?? "Something went wrong. Please try again." };

  await sendOrderEmail(s.supabase, id as string);
  revalidatePath("/");
  revalidatePath("/orders");
  return { ok: true, id: id as string };
}
