"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, isEmployee } from "@/lib/session";
import { sendApprovalRequest, sendChangeRequestNotice, sendOrderEmail } from "@/lib/order-send";
import { loadOrderDoc } from "@/lib/order-doc/load";
import type { Order } from "@/lib/types";

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
