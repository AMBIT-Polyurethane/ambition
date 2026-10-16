import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { buildOrderEmail } from "@/lib/order-email";
import { ORDERS_EMAIL } from "@/lib/env";
import { currentOrigin } from "@/lib/origin";
import type { Branch, Order, OrderItem } from "@/lib/types";

// Emails the filled order form to the orders inbox with a copy to whoever placed it.
export async function sendOrderEmail(supabase: SupabaseClient, orderId: string) {
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single<Order>();
  if (!order) return { status: "failed" as const, error: "Order not found" };
  const [{ data: items }, { data: branch }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", orderId).order("id"),
    order.branch_id
      ? supabase.from("branches").select("*").eq("id", order.branch_id).maybeSingle<Branch>()
      : Promise.resolve({ data: null }),
  ]);
  const origin = await currentOrigin();
  const mail = buildOrderEmail(order, (items ?? []) as OrderItem[], branch, `${origin}/orders/${order.id}`);
  const result = await sendEmail({
    to: [ORDERS_EMAIL],
    cc: order.placed_by_email ? [order.placed_by_email] : [],
    replyTo: order.placed_by_email ?? undefined,
    ...mail,
  });
  await supabase.rpc("mark_order_email", { p_order: orderId, p_status: result.status, p_error: result.error ?? null });
  return result;
}
