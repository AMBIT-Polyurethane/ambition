"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canCredit, canSetCredit } from "@/lib/credit";

// Customer credit (0066): payments the CRMs enter, collection notes, credit lines, and the import from QuickBooks.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS = "Customer credit needs the 0066 database update first. Ask Jeremiah to run it.";
const nice = (m: string) => (/payment_add|collection_note|credit_set|credit_import|function|schema cache/i.test(m) ? NEEDS : m);
const back = (id: string, kind: "msg" | "err", t: string): never => {
  revalidatePath("/credit", "layout");
  revalidatePath("/orders", "layout");
  redirect(`/credit/${id}?${kind}=${encodeURIComponent(t)}`);
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
  if (error) back(id, "err", nice(error.message));
  back(id, "msg", "Note saved.");
}

export async function noteDone(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !canCredit(s.profile)) return;
  const id = String(form.get("company") ?? "");
  await s.supabase.rpc("collection_note_done", { p_id: Number(form.get("id")) });
  back(id, "msg", "Follow-up updated.");
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
