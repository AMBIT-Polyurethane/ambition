import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEmailCustomers, sendEmail, type SendResult } from "@/lib/email";
import { buildApprovalRequestEmail, buildChangeRequestEmail, buildDeskEmail, buildOrderEmail, buildOrderUpdatedEmail, buildScheduledEmail, type DeskNotice } from "@/lib/order-email";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { pdfFileName, renderOrderPdf, type PdfAudience } from "@/lib/order-doc/pdf";
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

async function pdfAttachment(doc: OrderDoc, audience: PdfAudience, approveUrl?: string) {
  try {
    return [{ filename: pdfFileName(doc), content: await renderOrderPdf(doc, { approveUrl, audience }), contentType: "application/pdf" }];
  } catch (e) {
    console.error("[order pdf]", e);
    return []; // the email still goes out without the PDF
  }
}

async function sendToOrders(doc: OrderDoc, updated?: { changes: string[] }): Promise<SendResult> {
  const origin = await currentOrigin();
  const o = doc.order;
  const mail = buildOrderEmail(doc, `${origin}/orders/${o.id}`, updated);
  const cc = [o.placed_by_email, o.approval_status === "approved" && o.approval_method === "email_link" ? o.approval_email : null];
  return sendEmail({
    to: [ORDERS_EMAIL],
    cc: cc.filter(Boolean) as string[],
    replyTo: o.placed_by_email ?? undefined,
    attachments: await pdfAttachment(doc, "staff"),
    ...mail,
  });
}

/** Emails the order (with the printable PDF) to the orders inbox, copying whoever placed it. */
export async function sendOrderEmail(supabase: SupabaseClient, orderId: string, updated?: { changes: string[] }): Promise<SendResult> {
  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const result = await sendToOrders(doc, updated);
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
    attachments: await pdfAttachment(doc, "customer", approveUrl),
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

/** Who gets "Credit check needed": the people ticked in Admin > Email alerts (0043), admins included. */
export async function creditEmailList(supabase: SupabaseClient): Promise<{ name: string; email: string }[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, email")
    .in("role", ["employee", "admin"])
    .eq("status", "active")
    .eq("notify_credit", true)
    .order("full_name");
  if (error) return []; // before update 0043
  return ((data ?? []) as { full_name: string | null; email: string }[]).filter((r) => r.email).map((r) => ({ name: r.full_name ?? r.email, email: r.email }));
}

/** Order desk heads-ups: credit check needed (accounting), on hold (rep + order desk), ready to schedule (order desk). */
export async function sendDeskNotice(supabase: SupabaseClient, orderId: string, kind: DeskNotice, changes?: string[]): Promise<SendResult> {
  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const o = doc.order;
  let to: string[] = [];
  if (kind === "credit_needed" || kind === "corrected") {
    to = (await creditEmailList(supabase)).map((p) => p.email);
    if (to.length === 0) to = await staffWith(supabase, "credit_check");
  }
  else to = await staffWith(supabase, "order_desk");
  if (kind === "credit_hold" && o.placed_by_role !== "customer" && o.placed_by_email) to.push(o.placed_by_email);
  if (to.length === 0) to = [kind === "credit_needed" || kind === "corrected" ? ACCOUNTING_EMAIL : ORDERS_EMAIL];
  const origin = await currentOrigin();
  return sendEmail({ to, ...buildDeskEmail(kind, doc, `${origin}/orders/${orderId}`, changes) });
}

/** The customer's email for an order: whoever placed it (a contractor), else the approval email, else the company's. */
function customerEmail(doc: OrderDoc): string | null {
  const o = doc.order;
  return o.placed_by_role === "customer" ? o.placed_by_email : o.approval_email ?? doc.company?.email ?? null;
}

/** To the customer, once the CRM has updated the invoice after an edit: the updated order (PDF attached). */
export async function sendOrderUpdatedNotice(supabase: SupabaseClient, orderId: string, changes: string[]): Promise<SendResult> {
  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const o = doc.order;
  const to = customerEmail(doc);
  if (!to) return { status: "failed", error: "No customer email on file" };
  return sendEmail({
    to: [to],
    cc: o.placed_by_role !== "customer" && o.placed_by_email ? [o.placed_by_email] : [],
    replyTo: o.placed_by_role !== "customer" ? o.placed_by_email ?? ORDERS_EMAIL : ORDERS_EMAIL,
    attachments: await pdfAttachment(doc, "customer"),
    ...buildOrderUpdatedEmail(doc, changes),
  });
}

/** To the customer: approved and scheduled (PDF attached). The rep gets a copy. */
export async function sendScheduledNotice(supabase: SupabaseClient, orderId: string): Promise<SendResult> {
  const doc = await loadOrderDoc(supabase, orderId);
  if (!doc) return { status: "failed", error: "Order not found" };
  const o = doc.order;
  const customer = customerEmail(doc);
  if (!customer) {
    await supabase.rpc("order_mark_notified", { p_order: orderId, p_status: "failed", p_error: "No customer email on file" });
    return { status: "failed", error: "No customer email on file" };
  }
  const result = await sendEmail({
    to: [customer],
    cc: o.placed_by_role !== "customer" && o.placed_by_email ? [o.placed_by_email] : [],
    replyTo: o.placed_by_role !== "customer" ? o.placed_by_email ?? ORDERS_EMAIL : ORDERS_EMAIL,
    attachments: await pdfAttachment(doc, "customer"),
    ...buildScheduledEmail(doc),
  });
  await supabase.rpc("order_mark_notified", { p_order: orderId, p_status: result.status, p_error: result.error ?? null });
  return result;
}
