import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEmailCustomers, sendEmail, type SendResult } from "@/lib/email";
import { buildApprovalRequestEmail, buildChangeRequestEmail, buildDeskEmail, buildOrderEmail, buildScheduledEmail, type DeskNotice } from "@/lib/order-email";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { pdfFileName, renderOrderPdf } from "@/lib/order-doc/pdf";
import type { OrderDoc } from "@/lib/order-doc/types";
import { ACCOUNTING_EMAIL, ORDERS_EMAIL } from "@/lib/env";
import { currentOrigin } from "@/lib/origin";

/**
 * Staff orders need the customer's OK before they go to orders@. This is on once email can reach
 * customers (a verified sending domain), unless the CUSTOMER_APPROVAL setting says "off" (or "on").
 */
export function approvalsEnabled(): boolean {
  const flag = (process.env.CUSTOMER_APPROVAL ?? "").trim().toLowerCase();
  if (flag === "off") return false;
  if (flag === "on") return true;
  return canEmailCustomers();
}

async function pdfAttachment(doc: OrderDoc, approveUrl?: string) {
  try {
    return [{ filename: pdfFileName(doc), content: await renderOrderPdf(doc, { approveUrl }), contentType: "application/pdf" }];
  } catch (e) {
    console.error("[order pdf]", e);
    return []; // the email still goes out without the PDF
  }
}

async function sendToOrders(doc: OrderDoc): Promise<SendResult> {
  const origin = await currentOrigin();
  const o = doc.order;
  const mail = buildOrderEmail(doc, `${origin}/orders/${o.id}`);
  const cc = [o.placed_by_email, o.approval_status === "approved" && o.approval_method === "email_link" ? o.approval_email : null];
  return sendEmail({
    to: [ORDERS_EMAIL],
    cc: cc.filter(Boolean) as string[],
    replyTo: o.placed_by_email ?? undefined,
    attachments: await pdfAttachment(doc),
    ...mail,
  });
}

/** Emails the order (with the printable PDF) to the orders inbox, copying whoever placed it. */
export async function sendOrderEmail(supabase: SupabaseClient, orderId: string): Promise<SendResult> {
  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const result = await sendToOrders(doc);
  await supabase.rpc("mark_order_email", { p_order: orderId, p_status: result.status, p_error: result.error ?? null });
  return result;
}

/** Same, after the customer approved from the emailed link (no sign-in, so the link token proves access). */
export async function sendApprovedOrderByLink(supabase: SupabaseClient, token: string, doc: OrderDoc): Promise<SendResult> {
  const result = await sendToOrders(doc);
  await supabase.rpc("mark_order_email_by_link", { p_token: token, p_status: result.status, p_error: result.error ?? null });
  return result;
}

export type ApprovalSend = { status: "sent" | "failed" | "not_configured"; error?: string; setupMissing?: boolean };

/** Makes a fresh approval link and emails it (with the PDF) to the customer. Any older link stops working. */
export async function sendApprovalRequest(supabase: SupabaseClient, orderId: string, email: string): Promise<ApprovalSend> {
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const { error } = await supabase.rpc("request_order_approval", { p_order: orderId, p_email: email, p_token_hash: hash });
  if (error) {
    const setupMissing = /request_order_approval|could not find the function|schema cache/i.test(error.message);
    return { status: "failed", error: error.message, setupMissing };
  }

  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const origin = await currentOrigin();
  const approveUrl = `${origin}/approve/${token}`;
  const mail = buildApprovalRequestEmail(doc, approveUrl);
  const result = await sendEmail({
    to: [email],
    cc: doc.order.placed_by_email ? [doc.order.placed_by_email] : [],
    replyTo: doc.order.placed_by_email ?? undefined,
    attachments: await pdfAttachment(doc, approveUrl),
    ...mail,
  });
  await supabase.rpc("mark_approval_email", { p_order: orderId, p_status: result.status, p_error: result.error ?? null });
  return result;
}

/** Tells the rep the customer asked for changes. */
export async function sendChangeRequestNotice(doc: OrderDoc): Promise<SendResult> {
  const origin = await currentOrigin();
  const mail = buildChangeRequestEmail(doc, `${origin}/orders/${doc.order.id}`);
  return sendEmail({
    to: [doc.order.placed_by_email ?? ORDERS_EMAIL],
    replyTo: doc.order.approval_email ?? undefined,
    ...mail,
  });
}

/** Emails of AMBIT staff (not admins) whose boxes include this permission. */
async function staffWith(supabase: SupabaseClient, perm: string): Promise<string[]> {
  const { data } = await supabase.from("profiles").select("email").eq("role", "employee").eq("status", "active").contains("perms", [perm]);
  return ((data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
}

/** Order desk heads-ups: credit check needed (accounting), on hold (rep + order desk), ready to schedule (order desk). */
export async function sendDeskNotice(supabase: SupabaseClient, orderId: string, kind: DeskNotice): Promise<SendResult> {
  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const o = doc.order;
  let to: string[] = [];
  if (kind === "credit_needed") to = await staffWith(supabase, "credit_check");
  else to = await staffWith(supabase, "order_desk");
  if (kind === "credit_hold" && o.placed_by_role !== "customer" && o.placed_by_email) to.push(o.placed_by_email);
  if (to.length === 0) to = [kind === "credit_needed" ? ACCOUNTING_EMAIL : ORDERS_EMAIL];
  const origin = await currentOrigin();
  return sendEmail({ to, ...buildDeskEmail(kind, doc, `${origin}/orders/${orderId}`) });
}

/** To the customer: approved and scheduled (PDF attached). The rep gets a copy. */
export async function sendScheduledNotice(supabase: SupabaseClient, orderId: string): Promise<SendResult> {
  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const o = doc.order;
  const customer = o.placed_by_role === "customer" ? o.placed_by_email : o.approval_email ?? doc.company?.email ?? null;
  if (!customer) {
    await supabase.rpc("order_mark_notified", { p_order: orderId, p_status: "failed", p_error: "No customer email on file" });
    return { status: "failed", error: "No customer email on file" };
  }
  const result = await sendEmail({
    to: [customer],
    cc: o.placed_by_role !== "customer" && o.placed_by_email ? [o.placed_by_email] : [],
    replyTo: o.placed_by_role !== "customer" ? o.placed_by_email ?? ORDERS_EMAIL : ORDERS_EMAIL,
    attachments: await pdfAttachment(doc),
    ...buildScheduledEmail(doc),
  });
  await supabase.rpc("order_mark_notified", { p_order: orderId, p_status: result.status, p_error: result.error ?? null });
  return result;
}
