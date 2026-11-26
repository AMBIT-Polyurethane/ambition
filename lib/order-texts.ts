import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { sendSms, smsReady, type SmsResult } from "@/lib/sms";

// Customer texts about an order (0118): the approval link, scheduled, and picked up / delivered. Only to the
// order's texting number (the customer agreed to texts); never holds anything up.

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

async function orderPhone(db: SupabaseClient, orderId: string) {
  const doc = await loadOrderDoc(db, orderId);
  const to = doc?.order.sms_phone ?? null;
  return { doc, to };
}

export async function textApprovalLink(db: SupabaseClient, orderId: string, approveUrl: string): Promise<SmsResult | null> {
  if (!smsReady()) return null;
  const { doc, to } = await orderPhone(db, orderId);
  if (!doc || !to) return null;
  const o = doc.order;
  const where = o.delivery_method === "pickup" ? `pickup at AMBIT ${doc.branch?.name ?? ""}`.trim() : o.delivery_method === "dropship" ? "shipped from the supplier" : "delivery";
  return sendSms({ to, kind: "approval", ref: orderId, body: `AMBIT Polyurethane: please review and approve order ORD-${o.order_no} for ${o.company_name} (${where}): ${approveUrl}` });
}

export async function textScheduled(db: SupabaseClient, orderId: string): Promise<SmsResult | null> {
  if (!smsReady()) return null;
  const { doc, to } = await orderPhone(db, orderId);
  if (!doc || !to || !doc.order.scheduled_for) return null;
  const o = doc.order, b = doc.branch;
  const when = day(o.scheduled_for!);
  const body = o.delivery_method === "pickup"
    ? `AMBIT Polyurethane: order ORD-${o.order_no} is ready for pickup ${when} at AMBIT ${b?.name ?? ""}${b?.address ? `, ${b.address}` : ""}.${b?.phone ? ` Questions: ${b.phone}.` : ""}`
    : o.delivery_method === "dropship"
      ? `AMBIT Polyurethane: order ORD-${o.order_no} ships from the supplier ${when}.`
      : `AMBIT Polyurethane: order ORD-${o.order_no} is scheduled for delivery ${when}.${b?.phone ? ` Questions: ${b.phone}.` : ""}`;
  return sendSms({ to, kind: "scheduled", ref: orderId, body });
}

export async function textDone(db: SupabaseClient, orderId: string): Promise<SmsResult | null> {
  if (!smsReady()) return null;
  const { doc, to } = await orderPhone(db, orderId);
  if (!doc || !to) return null;
  const o = doc.order;
  const what = o.delivery_method === "pickup" ? "was picked up" : o.delivery_method === "dropship" ? "has shipped" : "was delivered";
  return sendSms({ to, kind: "done", ref: orderId, body: `AMBIT Polyurethane: order ORD-${o.order_no} ${what}. Thank you for your business!` });
}
