"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, isEmployee } from "@/lib/session";
import { sendApprovalRequest, sendChangeRequestNotice, sendDeskNotice, sendOrderEmail, sendScheduledNotice } from "@/lib/order-send";
import { loadOrderDoc } from "@/lib/order-doc/load";
import type { Order } from "@/lib/types";
import { kickForOrder } from "@/lib/inventory/sync";

const STATUSES = ["new", "processing", "completed", "cancelled"];

function back(id: string, kind: "msg" | "err", text: string): never {
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  redirect(`/orders/${id}?${kind}=${encodeURIComponent(text)}`);
}

export async function setOrderStatus(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!STATUSES.includes(status)) return;
  await s.supabase.from("orders").update({ status }).eq("id", id);
  await kickForOrder(s.supabase, id, `order ${status}`);
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}

export async function resendOrderEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const { data: order } = await s.supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (order && (order.approval_status === "pending" || order.approval_status === "changes_requested")) {
    back(id, "err", "This order goes to AMBIT orders once the customer approves it.");
  }
  await sendOrderEmail(s.supabase, id);
  revalidatePath(`/orders/${id}`);
}

/** Staff: send the approval email again (new link), optionally to a different address. */
export async function resendApproval(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const res = await sendApprovalRequest(s.supabase, id, email);
  if (res.status === "sent") back(id, "msg", `Approval email sent to ${email}. The earlier link no longer works.`);
  back(id, "err", res.error ?? "The approval email didn't go out.");
}

/** Staff: the customer approved by phone or in person. */
export async function recordApproval(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const { error } = await s.supabase.rpc("record_order_approval", { p_order: id, p_note: note });
  if (error) back(id, "err", error.message);
  const sent = await sendOrderEmail(s.supabase, id);
  back(id, "msg", sent.status === "sent" ? "Approval recorded. The order went to orders@ambitpu.com." : "Approval recorded.");
}

/** A signed-in contractor approves, or asks to change, an order AMBIT placed for their company. */
export async function customerDecision(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const approve = String(form.get("decision") ?? "") === "approve";
  const note = String(form.get("note") ?? "").trim();
  const { error } = await s.supabase.rpc("customer_order_decision", { p_order: id, p_approve: approve, p_note: note || null });
  if (error) back(id, "err", error.message);
  if (approve) {
    await sendOrderEmail(s.supabase, id);
    back(id, "msg", "Thanks, the order is approved and on its way to AMBIT.");
  }
  const doc = await loadOrderDoc(s.supabase, id);
  if (doc) await sendChangeRequestNotice(doc);
  back(id, "msg", "Thanks. Your AMBIT rep will send an updated order.");
}

// ------------------------------------------------------------------ order desk
// The database checks who may do each step (Admin > Accounts boxes); these just call it and send the emails.

/** CRM: AMBIT's PO number. The order moves on to the credit check. */
export async function setOrderPo(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const po = String(form.get("po") ?? "").trim();
  const { data: before } = await s.supabase.from("orders").select("credit_status").eq("id", id).maybeSingle<{ credit_status: string | null }>();
  const { error } = await s.supabase.rpc("order_set_po", { p_order: id, p_po: po });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "PO entered");
  if (!before?.credit_status) await sendDeskNotice(s.supabase, id, "credit_needed");
  back(id, "msg", before?.credit_status ? `PO # changed to ${po}.` : `PO # ${po} saved. Accounting has been asked for the credit check.`);
}

/** Accounting: release the order, or put it on hold (with a reason). */
export async function creditDecision(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const approve = String(form.get("decision") ?? "") === "approve";
  const note = String(form.get("note") ?? "").trim();
  const { error } = await s.supabase.rpc("order_credit_decision", { p_order: id, p_approve: approve, p_note: note || null });
  if (error) back(id, "err", error.message);
  await sendDeskNotice(s.supabase, id, approve ? "ready_to_schedule" : "credit_hold");
  back(id, "msg", approve ? "Released. The order desk can schedule it now." : "Put on credit hold. The rep and the order desk were told.");
}

/** CRM: delivery or pickup date. The customer is emailed that it's approved and scheduled. */
export async function scheduleOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const date = String(form.get("date") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back(id, "err", "Pick the delivery or pickup date.");
  const { error } = await s.supabase.rpc("order_schedule", { p_order: id, p_date: date, p_note: note || null });
  if (error) back(id, "err", error.message);
  const sent = await sendScheduledNotice(s.supabase, id);
  back(
    id,
    sent.status === "sent" ? "msg" : "err",
    sent.status === "sent"
      ? "Scheduled, and the customer was emailed."
      : `Scheduled, but the customer email didn't go out (${sent.error ?? sent.status}). Use Resend customer email.`,
  );
}

export async function resendScheduledEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const sent = await sendScheduledNotice(s.supabase, id);
  back(id, sent.status === "sent" ? "msg" : "err", sent.status === "sent" ? "Customer emailed again." : `The email didn't go out (${sent.error ?? sent.status}).`);
}

/** CRM or warehouse: delivered / picked up. */
export async function completeOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const { error } = await s.supabase.rpc("order_complete", { p_order: id });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "order completed");
  back(id, "msg", "Marked complete.");
}
