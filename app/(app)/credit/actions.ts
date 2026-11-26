"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canCredit, canSetCredit } from "@/lib/credit";

// Customer credit (0066): payments the CRMs enter, collection notes, credit lines, and the import from QuickBooks.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS = "Customer credit needs the 0066 database update first. Ask Jeremiah to run it.";
const nice = (m: string) => (/payment_add|collection_note|credit_set|credit_import|function|schema cache/i.test(m) ? NEEDS : m);
const back = (id: string, kind: "msg" | "err", t: string, to?: string): never => {
  revalidatePath("/credit", "layout");
  revalidatePath("/customers", "layout");
  revalidatePath("/orders", "layout");
  const base = to && to.startsWith(`/customers/${id}`) ? to : `/customers/${id}`;
  redirect(`${base}${base.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(t)}`);
};
const money = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : null;
};

export async function addPayment(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  if (!UUID.test(id)) return;
  const amount = money(form.get("amount"));
  if (!amount) back(id, "err", "Type the amount paid (like 2450.00).");
  const day = String(form.get("paid_on") ?? "");
  const order = String(form.get("order") ?? "");
  const { error } = await s.supabase.rpc("payment_add", {
    p_company: id,
    p_amount: amount,
    p_paid_on: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
    p_method: String(form.get("method") ?? "check"),
    p_ref: String(form.get("ref") ?? "").trim() || null,
    p_invoice: String(form.get("invoice") ?? "").trim() || null,
    p_order: UUID.test(order) ? order : null,
    p_note: String(form.get("note") ?? "").trim() || null,
  });
  if (error) back(id, "err", nice(error.message));
  back(id, "msg", `Payment of $${amount!.toFixed(2)} recorded. The balance and past due update right away.`);
}

export async function voidPayment(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canSetCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  const { error } = await s.supabase.rpc("payment_void", { p_id: Number(form.get("id")) });
  if (error) back(id, "err", nice(error.message));
  back(id, "msg", "Payment voided.");
}

export async function addNote(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  if (!UUID.test(id)) return;
  const follow = String(form.get("follow") ?? "");
  const { error } = await s.supabase.rpc("collection_note_add", {
    p_company: id,
    p_kind: String(form.get("kind") ?? "note"),
    p_body: String(form.get("body") ?? ""),
    p_promise: money(form.get("promise")),
    p_follow: /^\d{4}-\d{2}-\d{2}$/.test(follow) ? follow : null,
  });
  const to = String(form.get("back") ?? `/customers/${id}?tab=notes`);
  if (error) back(id, "err", nice(error.message), to);
  back(id, "msg", "Note saved.", to);
}

export async function noteDone(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  await s.supabase.rpc("collection_note_done", { p_id: Number(form.get("id")) });
  back(id, "msg", "Follow-up updated.", `/customers/${id}?tab=notes`);
}

export async function setCreditLine(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canSetCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  const raw = String(form.get("limit") ?? "").trim();
  const limit = raw === "" ? null : money(raw);
  if (raw !== "" && limit === null) back(id, "err", "Type the credit line as a number (like 25000).");
  const { error } = await s.supabase.rpc("credit_set", { p_company: id, p_limit: limit, p_terms: String(form.get("terms") ?? ""), p_note: String(form.get("note") ?? "") });
  if (error) back(id, "err", nice(error.message));
  back(id, "msg", "Credit line saved.");
}

export type ImportRow = { company_id: string; credit_limit?: number | null; balance?: number | null; current?: number | null; d1_30?: number | null; d31_60?: number | null; d61_90?: number | null; over_90?: number | null; terms?: string };

/** Credit > Import: the matched rows from a QuickBooks A/R aging (and/or customer list with credit limits). */
export async function importCredit(asOf: string, rows: ImportRow[]): Promise<{ ok: false; error: string } | { ok: true; n: number }> {
  const s = await getSession();
  if (!s?.profile || !canSetCredit(s.profile)) return { ok: false, error: "Only admins and accounting import credit." };
  const clean = rows.filter((r) => UUID.test(r.company_id)).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null && !(typeof v === "number" && !Number.isFinite(v)))));
  let n = 0;
  for (let k = 0; k < clean.length; k += 300) {
    const { data, error } = await s.supabase.rpc("credit_import", { p_as_of: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null, p_rows: clean.slice(k, k + 300) });
    if (error) return { ok: false, error: nice(error.message) };
    n += Number(data ?? 0);
  }
  revalidatePath("/credit", "layout");
  return { ok: true, n };
}

// ---------------------------------------------------------------------------------------------------------------------
// 0068: payments by every method (applied to invoices), credit status and shared lines, invoice import, auto-release.

const NEEDS68 = "This needs the 0068 database update first. Ask Jeremiah to run it.";
const nice68 = (m: string) => (/payment_record|credit_profile_set|credit_invoices_import|credit_auto_set|function|schema cache/i.test(m) ? NEEDS68 : m);
const refresh = (id?: string) => {
  revalidatePath("/credit", "layout");
  revalidatePath("/customers", "layout");
  revalidatePath("/orders", "layout");
  if (id) revalidatePath(`/customers/${id}`);
};

export type PaymentInput = {
  company: string; kind: "payment" | "credit" | "refund"; method: string; amount: number; paid_on: string; check_no?: string; ref?: string;
  note?: string; discount?: number; card_fee?: number | null; last4?: string; apply: { invoice_id: number; amount: number }[];
};

/** Record a payment, account credit, refund or write-off (admins, accounting and the order desk; refunds and write-offs are admin/accounting). */
export async function recordPayment(p: PaymentInput): Promise<{ ok: false; error: string } | { ok: true; id: number }> {
  const s = await getSession();
  if (!s?.profile || !canSetCredit(s.profile)) return { ok: false, error: "Only admins and Accounting record payments." };
  if (!UUID.test(p.company)) return { ok: false, error: "Pick the customer." };
  const amount = Math.round(Number(p.amount) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: "Type the amount (like 2450.00)." };
  const { data, error } = await s.supabase.rpc("payment_record", {
    p_company: p.company, p_kind: p.kind, p_method: p.method, p_amount: amount,
    p_paid_on: /^\d{4}-\d{2}-\d{2}$/.test(p.paid_on) ? p.paid_on : null,
    p_check_no: p.check_no?.trim() || null, p_ref: p.ref?.trim() || null, p_note: p.note?.trim() || null,
    p_discount: p.discount && p.discount > 0 ? Math.round(p.discount * 100) / 100 : 0,
    p_card_fee: p.card_fee && p.card_fee > 0 ? Math.round(p.card_fee * 100) / 100 : null,
    p_last4: p.last4?.trim() || null,
    p_apply: (p.apply ?? []).filter((a) => Number.isFinite(a.invoice_id) && a.amount > 0).map((a) => ({ invoice_id: a.invoice_id, amount: Math.round(a.amount * 100) / 100 })),
    p_order: null,
  });
  if (error) return { ok: false, error: nice68(error.message) };
  refresh(p.company);
  return { ok: true, id: Number(data) };
}

/** Void from the customer dashboard (keeps the record, takes it off the balance). */
export async function voidPayment68(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canSetCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  const { error } = await s.supabase.rpc("payment_void", { p_id: Number(form.get("id")) });
  refresh(id);
  redirect(`/customers/${id}?tab=payments&${error ? "err" : "msg"}=${encodeURIComponent(error ? nice(error.message) : "Payment voided. The balance is back.")}`);
}

/** Credit status, line, terms, shared line, flags (admins and accounting). */
export async function saveCreditProfile(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canSetCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  if (!UUID.test(id)) return;
  const status = String(form.get("status") ?? "");
  const raw = String(form.get("limit") ?? "").trim();
  const limit = raw === "" ? null : money(raw);
  const parent = String(form.get("parent") ?? "");
  const go = (k: "msg" | "err", t: string): never => {
    refresh(id);
    redirect(`/customers/${id}?tab=credit&${k}=${encodeURIComponent(t)}`);
  };
  if (raw !== "" && limit === null) go("err", "Type the credit line as a number (like 25000).");
  const { error } = await s.supabase.rpc("credit_profile_set", {
    p_company: id,
    p_status: ["line", "revoked", "advance", "review"].includes(status) ? status : null,
    p_limit: limit,
    p_terms: String(form.get("terms") ?? ""),
    p_note: String(form.get("note") ?? ""),
    p_parent: UUID.test(parent) ? parent : null,
    p_manual: form.get("manual") === "on",
    p_flags: form.getAll("flags").map(String).filter((f) => ["collections", "payment_plan", "high_risk", "tax_issue"].includes(f)),
  });
  if (error) go("err", nice68(error.message));
  go("msg", "Credit saved.");
}

export type InvoiceRow = { company_id: string; kind: string; doc_no: string; txn_date: string; due_date: string; amount: number; open: number; location: string; qb_name: string };

/** Credit > Import: every open invoice from the QuickBooks A/R Aging Detail. Anything not in it was paid in QuickBooks. */
export async function importInvoices(asOf: string, rows: InvoiceRow[], full: boolean): Promise<{ ok: false; error: string } | { ok: true; rows: number; customers: number; closed: number }> {
  const s = await getSession();
  if (!s?.profile || !canSetCredit(s.profile)) return { ok: false, error: "Only admins and accounting import invoices." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { ok: false, error: "Pick the date the report is as of." };
  const clean = rows.filter((r) => UUID.test(r.company_id) && /^\d{4}-\d{2}-\d{2}$/.test(r.txn_date) && Number.isFinite(r.amount) && Number.isFinite(r.open));
  if (!clean.length) return { ok: false, error: "No invoice lines matched a customer." };
  // One call so the "paid in QuickBooks" step sees every line.
  const { data, error } = await s.supabase.rpc("credit_invoices_import", { p_as_of: asOf, p_rows: clean, p_full: full });
  if (error) return { ok: false, error: nice68(error.message) };
  refresh();
  const r = (data ?? {}) as { rows?: number; customers?: number; closed?: number };
  return { ok: true, rows: Number(r.rows ?? 0), customers: Number(r.customers ?? 0), closed: Number(r.closed ?? 0) };
}

/** Admins: orders release themselves at the credit step when the customer qualifies. */
export async function setAutoRelease(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const on = String(form.get("on") ?? "") === "1";
  const { error } = await s.supabase.rpc("credit_auto_set", { p_on: on });
  revalidatePath("/credit", "layout");
  redirect(`/credit?${error ? "err" : "msg"}=${encodeURIComponent(error ? nice68(error.message) : on ? "Automatic credit release is on. Orders from customers with a line of credit, nothing past due and room on the line release themselves after the Invoice # is entered." : "Automatic credit release is off. Accounting releases every order.")}`);
}
