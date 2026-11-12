"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, isEmployee } from "@/lib/session";
import { sendApprovalRequest, sendChangeRequestNotice, sendDeskNotice, sendOrderEmail, sendOrderUpdatedNotice, sendScheduledNotice } from "@/lib/order-send";
import { loadOrderDoc } from "@/lib/order-doc/load";
import type { Order } from "@/lib/types";
import { kickForOrder } from "@/lib/inventory/sync";
import { can } from "@/lib/access";
import { money } from "@/lib/format";
import { changesText, type OrderChange } from "@/lib/order-edit";
import { serviceClient, serviceReady } from "@/lib/supabase/service";

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
  if (status === "completed") {
    const { count } = await s.supabase.from("order_files").select("id", { count: "exact", head: true }).eq("order_id", id).eq("kind", "bol");
    if (!count) back(id, "err", "Attach the signed BOL first: use Mark shipped out / Mark picked up on the order desk card.");
  }
  await s.supabase.from("orders").update({ status }).eq("id", id);
  await kickForOrder(s.supabase, id, `order ${status}`);
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Sales rep box on an order (admins and the order desk): who gets credit for this order on the sales goal
 * trackers, and (if ticked) the customer's rep from now on, which also credits that rep with the customer's other
 * orders that had no rep. Staff can't write orders (or, unless admin, customers) directly, so after the check here
 * both are saved with the server key, one column each.
 */
export async function setOrderRep(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  const admin = s.profile.role === "admin";
  if (!admin && !can(s.profile, "order_desk")) back(id, "err", "Only admins and the order desk can change the sales rep.");
  const raw = String(form.get("rep") ?? "");
  const rep = UUID.test(raw) ? raw : null;
  const house = raw === "house"; // House Account: no sales rep gets credit
  if (!rep && !house) back(id, "err", "Pick the sales rep, or House Account.");
  const alsoCustomer = form.get("customer") === "1";

  const { data: o } = await s.supabase.from("orders").select("id, company_id, company_name, sales_rep_id").eq("id", id).maybeSingle<{
    id: string;
    company_id: string | null;
    company_name: string;
    sales_rep_id: string | null;
  }>();
  if (!o) back(id, "err", "Order not found.");
  let name = "";
  if (rep) {
    const { data: p } = await s.supabase.from("profiles").select("full_name, email, role, status").eq("id", rep).maybeSingle<{
      full_name: string | null;
      email: string;
      role: string;
      status: string;
    }>();
    if (!p || (p.role !== "employee" && p.role !== "admin") || p.status !== "active") back(id, "err", "Pick someone on AMBIT staff.");
    name = p.full_name?.trim() || p.email;
  }

  if (!serviceReady()) back(id, "err", "The sales rep can't be saved yet: SUPABASE_SECRET_KEY isn't set in Vercel.");
  const db = serviceClient();
  {
    const { error } = await db.from("orders").update({ sales_rep_id: rep, house_account: house }).eq("id", id);
    if (error) back(id, "err", `The sales rep wasn't saved: ${error.message}`);
  }
  if (alsoCustomer && o.company_id) {
    const { error } = await db.from("companies").update({ sales_rep_id: rep, house_account: house }).eq("id", o.company_id);
    if (error) back(id, "err", `This order's sales rep is saved, but not ${o.company_name}'s: ${error.message}`);
    revalidatePath("/admin/companies");
  }
  revalidatePath("/sales-goals");
  revalidatePath("/");
  back(
    id,
    "msg",
    rep
      ? `${name} now gets credit for this order${alsoCustomer && o.company_id ? ` and is ${o.company_name}'s sales rep from now on` : ""}.`
      : `This order is a House Account order: no sales rep gets credit${alsoCustomer && o.company_id ? `, and ${o.company_name} is a House Account from now on` : ""}.`,
  );
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

/** Staff: move the order past the customer step without the customer's email approval. */
export async function approveWithoutEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const { error } = await s.supabase.rpc("order_approve_without_customer", { p_order: id, p_note: note || null });
  if (error) back(id, "err", error.message);
  const sent = await sendOrderEmail(s.supabase, id);
  back(
    id,
    "msg",
    `Approved without customer email approval.${sent.status === "sent" ? " The order went to orders@ambitpu.com." : ""} It's ready for its Sales Order # and Invoice #.`,
  );
}

// ------------------------------------------------------------------ editing an order (0041)
export type EditLine = { id?: number | null; product_id?: string | null; qty: number };

/**
 * AMBIT staff: add items or change / remove quantities on an open order. Then whoever's next hears about it:
 * the customer gets a fresh approval email (still waiting on them), the CRM gets "invoice update needed"
 * (the Invoice # was already in), or orders@ gets the updated order.
 */
export async function editOrder(input: { id: string; lines: EditLine[]; note: string }): Promise<{ ok: false; error: string } | never> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !(s.profile.role === "admin" || can(s.profile, "ordering") || can(s.profile, "order_desk"))) {
    return { ok: false, error: "You don't have access to edit orders." };
  }
  const id = String(input.id ?? "");
  const lines = (input.lines ?? [])
    .map((l) => ({ id: l.id ?? null, product_id: l.product_id ?? null, qty: Math.round(Number(l.qty) * 100) / 100 }))
    .filter((l) => Number.isFinite(l.qty) && l.qty >= 0 && (l.id || l.product_id));
  const { data, error } = await s.supabase.rpc("order_edit", { p_order: id, p_lines: lines, p_note: String(input.note ?? "").slice(0, 500) || null });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { revision?: number; invoice_update?: boolean; customer?: boolean; closed?: boolean; changes?: OrderChange[] };
  const changes = changesText(r.changes);
  await kickForOrder(s.supabase, id, "order edited");
  const rev = `Saved as revision ${r.revision ?? 2}.`;
  if (r.closed) {
    const sent = r.invoice_update ? await sendDeskNotice(s.supabase, id, "invoice_update", changes) : null;
    back(
      id,
      "msg",
      `${rev} Stock was corrected (what changed went back in, the new amounts came out), and the spreadsheet updates on its next sync.${
        r.invoice_update ? ` The order desk${sent?.status === "sent" ? " was emailed to" : " needs to"} update the invoice. If the total changes, the credit team is emailed to collect or credit the difference.` : ""
      }`,
    );
  }
  if (r.customer) {
    const { data: o } = await s.supabase.from("orders").select("approval_email").eq("id", id).maybeSingle<{ approval_email: string | null }>();
    if (o?.approval_email) {
      const sent = await sendApprovalRequest(s.supabase, id, o.approval_email);
      back(id, sent.status === "sent" ? "msg" : "err", `${rev} ${sent.status === "sent" ? `A fresh approval email went to ${o.approval_email} (the old link no longer works).` : `The new approval email didn't go out (${sent.error ?? sent.status}). Use Resend below.`}`);
    }
    back(id, "msg", `${rev} The customer still needs to approve it.`);
  }
  if (r.invoice_update) {
    const sent = await sendDeskNotice(s.supabase, id, "invoice_update", changes);
    back(
      id,
      "msg",
      `${rev} It went back to the order desk for an invoice update${sent.status === "sent" ? " (they were emailed)" : ""}. If the total goes up, accounting checks credit again.`,
    );
  }
  const sent = await sendOrderEmail(s.supabase, id, { changes });
  back(id, "msg", `${rev}${sent.status === "sent" ? " The updated order went to orders@ambitpu.com." : ""}`);
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

/** Files the app uploaded to the order-files bucket (paths and names), as sent by the upload forms. */
function filesFrom(form: FormData): { path: string; name: string }[] {
  const paths = form.getAll("file_path").map(String);
  const names = form.getAll("file_name").map(String);
  return paths.filter(Boolean).map((path, i) => ({ path, name: names[i] ?? "" }));
}

async function addFiles(s: NonNullable<Awaited<ReturnType<typeof getSession>>>, id: string, kind: "invoice" | "bol", files: { path: string; name: string }[]) {
  for (const f of files) {
    const { error } = await s.supabase.rpc("order_add_file", { p_order: id, p_kind: kind, p_path: f.path, p_name: f.name || null });
    if (error) return error.message;
  }
  return null;
}

/** CRM: AMBIT's Sales Order # and Invoice # (and the invoice itself, if it's ready). The order moves on to the credit check. */
export async function setOrderPo(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const po = String(form.get("po") ?? "").trim();
  const invoice = String(form.get("invoice") ?? "").trim();
  const { data: before } = await s.supabase
    .from("orders")
    .select("credit_status, invoice_update_at")
    .eq("id", id)
    .maybeSingle<{ credit_status: string | null; invoice_update_at: string | null }>();
  // Prices from the invoice: [{ id, price }] for every line (spray foam and fiberglass have none until now). ISO that
  // goes with more than one foam set has a price per set instead: { id, parts: [{ with, qty, price }] }.
  type Part = { with: number | null; qty: number; price: number };
  let prices: ({ id: number; price: number } | { id: number; parts: Part[] })[] | null = null;
  try {
    const raw = JSON.parse(String(form.get("prices") ?? "null"));
    if (Array.isArray(raw)) {
      prices = raw
        .map((p): { id: number; price: number } | { id: number; parts: Part[] } =>
          Array.isArray(p?.parts)
            ? {
                id: Number(p.id),
                parts: (p.parts as Part[]).map((x) => ({ with: x.with === null || x.with === undefined ? null : Number(x.with), qty: Number(x.qty), price: Number(x.price) })),
              }
            : { id: Number(p.id), price: Number(p.price) },
        )
        .filter((p) =>
          Number.isFinite(p.id) && ("parts" in p ? p.parts.length > 0 && p.parts.every((x) => Number.isFinite(x.qty) && Number.isFinite(x.price)) : Number.isFinite(p.price)),
        );
    }
  } catch {
    prices = null;
  }
  const { error } = await s.supabase.rpc("order_set_numbers", { p_order: id, p_po: po, p_invoice: invoice, p_prices: prices });
  if (error) back(id, "err", error.message);
  const files = filesFrom(form);
  const fileErr = await addFiles(s, id, "invoice", files);
  await kickForOrder(s.supabase, id, "PO entered");
  // After an edit: the invoice now matches. Credit again only if the total went up; the customer gets the updated order.
  if (before?.invoice_update_at) {
    const { data: done, error: doneErr } = await s.supabase.rpc("order_invoice_update_done", { p_order: id });
    if (doneErr) back(id, "err", doneErr.message);
    const r = (done ?? {}) as { was?: boolean; reopened?: boolean; closed?: boolean; before?: number; after?: number; changes?: OrderChange[] };
    if (r.was) {
      const changes = changesText(r.changes);
      if (r.reopened) await sendDeskNotice(s.supabase, id, "credit_needed");
      // Corrected after pickup / delivery: no credit check (the goods are gone); the credit team settles the difference.
      const diff = r.closed && r.before !== undefined && r.after !== undefined && Math.abs(Number(r.after) - Number(r.before)) > 0.004;
      if (diff) await sendDeskNotice(s.supabase, id, "corrected", [`Total ${money(Number(r.before))} → ${money(Number(r.after))}`, ...changes]);
      const mailed = await sendOrderUpdatedNotice(s.supabase, id, changes);
      const total = r.before !== undefined && r.after !== undefined ? ` Total ${money(r.before)} → ${money(r.after)}.` : "";
      back(
        id,
        fileErr ? "err" : "msg",
        `Invoice # ${invoice} and prices saved.${total} ${
          r.closed
            ? diff
              ? `The credit team was emailed to ${Number(r.after) > Number(r.before) ? "collect" : "credit the customer"} the difference.`
              : "The total didn't change."
            : r.reopened ? "The total went up, so accounting was asked to check credit again." : "Credit stays approved."
        } ${mailed.status === "sent" ? "The customer was emailed the updated order." : `The customer wasn't emailed (${mailed.error ?? mailed.status}).`}${
          fileErr ? ` The invoice file wasn't added: ${fileErr}` : ""
        }`,
      );
    }
  }
  if (!before?.credit_status) await sendDeskNotice(s.supabase, id, "credit_needed");
  if (fileErr) back(id, "err", `Sales Order # and Invoice # saved, but the invoice file wasn't added: ${fileErr}`);
  const added = files.length ? ` ${files.length === 1 ? "Invoice file" : `${files.length} invoice files`} added.` : "";
  back(
    id,
    "msg",
    before?.credit_status
      ? `Sales Order # ${po}, Invoice # ${invoice}${prices ? " and prices" : ""} saved.${added}`
      : `Sales Order # ${po}, Invoice # ${invoice}${prices ? " and prices" : ""} saved.${added} Accounting has been asked for the credit check.`,
  );
}

/** Order desk: add the invoice file later (after the numbers are in). */
export async function addInvoiceFile(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const files = filesFrom(form);
  if (!files.length) back(id, "err", "Choose the invoice file first.");
  const err = await addFiles(s, id, "invoice", files);
  if (err) back(id, "err", err);
  back(id, "msg", files.length === 1 ? "Invoice file added." : `${files.length} invoice files added.`);
}

/** Accounting: release the order, or put it on hold (with a reason). */
export async function creditDecision(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const approve = String(form.get("decision") ?? "") === "approve";
  const note = String(form.get("note") ?? "").trim();
  const chargeTax = form.get("charge_tax") === "on";
  // COD Only / No Checks Allowed: set on release (the customer's next order starts the same way).
  // Customer Has Already Paid (0042): nothing to collect, so COD Only / No Checks come off this order.
  const pay = approve ? { p_cod: form.get("cod") === "on", p_no_checks: form.get("no_checks") === "on", p_prepaid: form.get("prepaid") === "on" } : {};
  const { error } = await s.supabase.rpc("order_credit_decision", { p_order: id, p_approve: approve, p_note: note || null, p_charge_tax: chargeTax, ...pay });
  if (error) back(id, "err", error.message);
  await sendDeskNotice(s.supabase, id, approve ? "ready_to_schedule" : "credit_hold");
  const flags = pay.p_prepaid ? "customer has already paid" : [pay.p_cod ? "COD only" : "", pay.p_no_checks ? "no checks" : ""].filter(Boolean).join(", ");
  back(id, "msg", approve ? `Released${flags ? ` (${flags})` : ""}. The order desk can schedule it now.` : "Put on credit hold. The rep and the order desk were told.");
}

/** Accounting, at the credit check: waiting on the customer's payment before releasing (0064). */
export async function payWaiting(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const on = String(form.get("on") ?? "1") === "1";
  const { error } = await s.supabase.rpc("order_pay_waiting", { p_order: id, p_on: on });
  if (error) back(id, "err", /order_pay_waiting|function|schema cache/i.test(error.message) ? "Waiting on customer payment needs the 0064 database update first. Ask Jeremiah to run it." : error.message);
  back(id, "msg", on ? "Marked Waiting on customer payment. When it comes in, release the order (Customer Has Already Paid is ticked for you)." : "Took off Waiting on customer payment.");
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
      : sent.status === "not_configured"
        ? "Scheduled. Email isn't set up yet, so the customer wasn't emailed. Let them know, then tap Customer Approved without Email."
        : `Scheduled, but the customer email didn't go out (${sent.error ?? sent.status}). Use Resend customer email, or let them know and tap Customer Approved without Email.`,
  );
}

export async function resendScheduledEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const sent = await sendScheduledNotice(s.supabase, id);
  back(id, sent.status === "sent" ? "msg" : "err", sent.status === "sent" ? "Customer emailed again." : `The email didn't go out (${sent.error ?? sent.status}).`);
}

/** Order desk, until email is set up: the customer knows the date (told by phone), so the missing email is fine. */
export async function notifyOverride(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const { error } = await s.supabase.rpc("order_notify_override", { p_order: id });
  if (error) back(id, "err", error.message);
  back(id, "msg", "Marked as approved by the customer without email. The order is ready to go out.");
}

/** CRM or warehouse: delivered / picked up, with the signed BOL (photo or scan) attached. */
export async function completeOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const files = filesFrom(form);
  const fileErr = await addFiles(s, id, "bol", files);
  if (fileErr) back(id, "err", `The signed BOL wasn't saved: ${fileErr}`);
  const { error } = await s.supabase.rpc("order_complete", { p_order: id });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "order completed");
  back(id, "msg", "Marked complete. The signed BOL is saved on the order.");
}

/** Cancel an order with a reason. Its stock is released and the inventory sheet line is marked Cancelled. */
export async function cancelOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const { error } = await s.supabase.rpc("order_cancel", { p_order: id, p_reason: reason });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "order cancelled");
  back(id, "msg", "Order cancelled. Its stock is released.");
}

/** Admins: delete a cancelled order for good (test orders, mistakes). */
export async function deleteOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const id = String(form.get("id") ?? "");
  if (form.get("sure") !== "on") back(id, "err", "Tick the box to confirm, then delete.");
  const { data: no, error } = await s.supabase.rpc("order_delete", { p_order: id });
  if (error) back(id, "err", error.message);
  revalidatePath("/orders");
  revalidatePath("/orders/desk");
  revalidatePath("/orders/deleted");
  redirect(`/orders?msg=${encodeURIComponent(`${no} was deleted. It's saved in the Deleted orders log, so Jeremiah can put it back.`)}`);
}

/** The order keepers (Jeremiah): put a deleted order back, open again (or as cancelled, for the record). */
export async function restoreDeleted(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const log = String(form.get("log") ?? "");
  const reopen = form.get("reopen") !== "0";
  const { data: no, error } = await s.supabase.rpc("order_restore", { p_log: log, p_reopen: reopen });
  revalidatePath("/orders");
  revalidatePath("/orders/desk");
  revalidatePath("/orders/deleted");
  if (error) redirect(`/orders/deleted?err=${encodeURIComponent(error.message)}`);
  const { data: o } = await s.supabase.from("orders").select("id, branch_id").eq("order_no", Number(String(no).replace(/\D/g, ""))).maybeSingle<{ id: string; branch_id: string | null }>();
  if (o) await kickForOrder(s.supabase, o.id, "order put back");
  redirect(o ? `/orders/${o.id}?msg=${encodeURIComponent(`${no} is back${reopen ? " and open again; its stock is held again" : " (as cancelled)"}.`)}` : "/orders/deleted");
}


/** Item variance (admins, or the Item variance box): take a line's drums from a different lot (or another ISO brand). */
export async function changeLot(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const line = Number(form.get("line"));
  const lot = Number(form.get("lot"));
  const reason = String(form.get("reason") ?? "").trim();
  if (!line || !lot) back(id, "err", "Choose a lot.");
  const { data, error } = await s.supabase.rpc("order_variance_lot", { p_line: line, p_lot: lot, p_reason: reason || null });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "lot changed");
  back(id, "msg", `Lot changed to ${data}. The spreadsheet updates in a moment.`);
}

/** Item variance: load a different product type than the one ordered (Summer / Winter, another product in the same category). */
export async function swapItem(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const item = Number(form.get("item"));
  const product = String(form.get("product") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!item || !product) back(id, "err", "Choose what to load instead.");
  const { data, error } = await s.supabase.rpc("order_item_swap", { p_item: item, p_product: product, p_reason: reason });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "item type changed");
  back(id, "msg", `Now loading ${data}. The change is saved on the item variance table.`);
}
