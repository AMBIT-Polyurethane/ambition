"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { canSalesAll, canSalesHub } from "@/lib/access";
import { claudeReady, friendlyClaudeError } from "@/lib/ai/claude";
import { crmActivities, crmCustomers, crmLeads, crmTasks, todayCentral } from "@/lib/crm";
import { writeBrief, writeCustomerRead, type Brief, type CustomerRead } from "@/lib/crm-ai";
import type { LeadStage } from "@/lib/crm-shared";
import type { CallList, Outcome } from "@/lib/calls-shared";

// Sales CRM (0109). Everything goes through the database's crm_* functions with the person's own login, so the
// database decides whose customers and leads they can touch.

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function hub() {
  const s = await getSession();
  if (!s?.profile || !canSalesHub(s.profile)) return null;
  return { ...s, profile: s.profile };
}
const done = (company?: string | null) => {
  revalidatePath("/sales", "layout");
  if (company) revalidatePath(`/sales/customers/${company}`);
};

/** A call, visit, text, email or note (and maybe a follow-up). */
export async function logActivity(input: { company_id?: string | null; lead_id?: string | null; kind: string; body: string; follow_up?: { title: string; due_on: string } | null }): Promise<R> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  const f = input.follow_up && input.follow_up.title.trim() ? { title: input.follow_up.title.trim().slice(0, 300), due_on: DAY.test(input.follow_up.due_on) ? input.follow_up.due_on : "" } : null;
  const { error } = await s.supabase.rpc("crm_log", {
    p: { company_id: UUID.test(input.company_id ?? "") ? input.company_id : null, lead_id: UUID.test(input.lead_id ?? "") ? input.lead_id : null, kind: input.kind, body: input.body.slice(0, 4000), follow_up: f },
  });
  if (error) return { ok: false, error: error.message };
  done(input.company_id);
  return { ok: true };
}

export async function saveTask(input: { id?: number | null; company_id?: string | null; lead_id?: string | null; title: string; due_on: string; assigned_to?: string | null; source?: string }): Promise<R> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  const { error } = await s.supabase.rpc("crm_task_save", {
    p: {
      id: input.id ?? null,
      company_id: UUID.test(input.company_id ?? "") ? input.company_id : null,
      lead_id: UUID.test(input.lead_id ?? "") ? input.lead_id : null,
      title: input.title.trim().slice(0, 300),
      due_on: DAY.test(input.due_on) ? input.due_on : null,
      assigned_to: UUID.test(input.assigned_to ?? "") ? input.assigned_to : null,
      source: input.source ?? "manual",
    },
  });
  if (error) return { ok: false, error: error.message };
  done(input.company_id);
  return { ok: true };
}

export async function taskDone(id: number, isDone: boolean, company?: string | null): Promise<R> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  const { error } = await s.supabase.rpc("crm_task_done", { p_id: id, p_done: isDone });
  if (error) return { ok: false, error: error.message };
  done(company);
  return { ok: true };
}

export type LeadInput = { id?: string | null; name: string; contact_name?: string; phone?: string; email?: string; city?: string; state?: string; size_note?: string; source?: string; notes?: string; rep_id?: string | null; company_id?: string | null };
export async function saveLead(input: LeadInput): Promise<R<{ id: string }>> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  const { data, error } = await s.supabase.rpc("crm_lead_save", { p: { ...input, rep_id: UUID.test(input.rep_id ?? "") ? input.rep_id : null, company_id: UUID.test(input.company_id ?? "") ? input.company_id : null } });
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true, id: String(data) };
}

export async function moveLead(id: string, stage: LeadStage, reason?: string): Promise<R> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  const { error } = await s.supabase.rpc("crm_lead_move", { p_id: id, p_stage: stage, p_reason: reason ?? null });
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}

/** Admins: give customers to a rep, or make them house accounts. */
export async function assignCustomers(ids: string[], rep: string | null, house: boolean): Promise<R<{ n: number }>> {
  const s = await getSession();
  if (!s?.profile || !canSalesAll(s.profile)) return { ok: false, error: "Only admins assign customers to reps." };
  const list = ids.filter((x) => UUID.test(x)).slice(0, 2000);
  if (!list.length) return { ok: false, error: "Pick at least one customer." };
  const { data, error } = await s.supabase.rpc("crm_assign", { p_companies: list, p_rep: house ? null : UUID.test(rep ?? "") ? rep : null, p_house: house });
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true, n: Number(data ?? 0) };
}

// ------------------------------------------------------------------ AI

/** The rep's briefing for today (written once a day, or again on "Refresh"). */
export async function makeBrief(rep: string | null): Promise<R<{ brief: Brief; at: string }>> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  if (!claudeReady()) return { ok: false, error: "AI isn't set up on this server yet." };
  const who = canSalesAll(s.profile) && rep && UUID.test(rep) ? rep : canSalesAll(s.profile) && rep === "all" ? null : s.profile.id;
  const today = todayCentral();
  try {
    const [{ rows, error }, tasks, leads] = await Promise.all([crmCustomers(s.supabase, who), crmTasks(s.supabase, who), crmLeads(s.supabase, who)]);
    if (error) return { ok: false, error };
    const { data: p } = who ? await s.supabase.from("profiles").select("full_name").eq("id", who).maybeSingle<{ full_name: string | null }>() : { data: { full_name: "the whole team" } };
    const brief = await writeBrief(s.supabase, `${who ?? "all"}:${today}`, p?.full_name ?? "the rep", rows, tasks, leads, today);
    return { ok: true, brief, at: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: friendlyClaudeError(e) };
  }
}

/** The AI read on one customer (once a day, or again on "Refresh"). */
export async function makeCustomerRead(company: string): Promise<R<{ read: CustomerRead; at: string }>> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  if (!claudeReady()) return { ok: false, error: "AI isn't set up on this server yet." };
  if (!UUID.test(company)) return { ok: false, error: "Customer not found." };
  const today = todayCentral();
  try {
    const [{ rows, error }, prod, acts] = await Promise.all([
      crmCustomers(s.supabase, null, company),
      s.supabase.rpc("crm_customer_products", { p_company: company }),
      crmActivities(s.supabase, { company, limit: 12 }),
    ]);
    if (error) return { ok: false, error };
    const c = rows[0];
    if (!c) return { ok: false, error: "That isn't one of your customers." };
    const products = ((prod.data ?? []) as { sku: string | null; name: string; category: string | null; total: number; orders: number; last: string }[]).map((x) => ({ ...x, total: Number(x.total), orders: Number(x.orders) }));
    const read = await writeCustomerRead(s.supabase, `${company}:${today}`, c, products, acts, today);
    return { ok: true, read, at: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: friendlyClaudeError(e) };
  }
}

// ------------------------------------------------------------------ QuickBooks sales history

export type HistoryRow = { company_id: string | null; qb_name: string; txn_date: string; txn_type: string; doc_no: string; item: string; qty: number | null; amount: number };

/** Admins: one chunk of the QuickBooks "Sales by Customer Detail" report. The first chunk clears that date range. */
export async function importHistory(rows: HistoryRow[], first: boolean, from: string, through: string): Promise<R<{ n: number }>> {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return { ok: false, error: "Only admins import sales history." };
  if (!DAY.test(from) || !DAY.test(through)) return { ok: false, error: "Pick the report's date range." };
  const clean = rows
    .filter((r) => DAY.test(r.txn_date) && Number.isFinite(r.amount) && r.txn_date >= from && r.txn_date <= through)
    .slice(0, 3000)
    .map((r) => ({ ...r, company_id: UUID.test(r.company_id ?? "") ? r.company_id : null, qty: Number.isFinite(r.qty ?? NaN) ? r.qty : null }));
  const { data, error } = await s.supabase.rpc("sales_history_import", { p_rows: clean, p_first: first, p_from: from, p_through: through });
  if (error) return { ok: false, error: /sales_history_import|schema cache|function/i.test(error.message) ? "This needs database update 0109 first." : error.message };
  if (!first) done();
  return { ok: true, n: Number(data ?? 0) };
}

export async function importFinished(): Promise<void> {
  done();
}

// ---- Call lists (0113) ----

/** Log one call on a Win-back or Cold-lead row. */
export async function saveCall(input: { id: number; outcome: Outcome; note?: string; next_on?: string | null }): Promise<R<{ lead_id: string | null }>> {
  const s = await hub();
  if (!s) return { ok: false, error: "You don't have access to the sales hub." };
  const next = input.next_on && DAY.test(input.next_on) ? input.next_on : null;
  const { data, error } = await s.supabase.rpc("crm_call_save", { p_id: input.id, p_outcome: input.outcome, p_note: (input.note ?? "").slice(0, 4000) || null, p_next: next });
  if (error) return { ok: false, error: /crm_call_save/.test(error.message) ? "Call lists need database update 0113 first." : error.message };
  revalidatePath("/sales", "layout");
  return { ok: true, lead_id: ((data ?? {}) as { lead_id?: string | null }).lead_id ?? null };
}

export type CallLoadRow = {
  list: CallList; rep_id: string; name: string; company_name?: string; contact_name?: string; phone?: string; email?: string; street?: string;
  city?: string; state?: string; zip?: string; source?: string; kind_guess?: string; priority?: string; last_invoice?: string; sales_12mo?: number | null;
  prev_rep?: string; sheet_note?: string;
};
/** Admins: load reviewed call lists (rows already on a list are skipped). */
export async function loadCalls(rows: CallLoadRow[], batch: string): Promise<R<{ added: number; skipped: number }>> {
  const s = await hub();
  if (!s || s.profile.role !== "admin") return { ok: false, error: "Only admins load call lists." };
  let added = 0, skipped = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500).filter((r) => UUID.test(r.rep_id) && (r.list === "winback" || r.list === "cold"));
    skipped += rows.slice(i, i + 500).length - part.length;
    const { data, error } = await s.supabase.rpc("crm_calls_load", { p_rows: part, p_batch: batch.slice(0, 60) });
    if (error) return { ok: false, error: /crm_calls_load/.test(error.message) ? "Call lists need database update 0113 first." : error.message };
    const r = (data ?? {}) as { added?: number; skipped?: number };
    added += Number(r.added ?? 0);
    skipped += Number(r.skipped ?? 0);
  }
  revalidatePath("/sales", "layout");
  return { ok: true, added, skipped };
}

/** Admins and sales managers: give calls to another rep. */
export async function assignCalls(ids: number[], rep: string): Promise<R<{ n: number }>> {
  const s = await hub();
  if (!s || !canSalesAll(s.profile)) return { ok: false, error: "Only admins and sales managers move calls." };
  if (!UUID.test(rep)) return { ok: false, error: "Pick the rep." };
  const { data, error } = await s.supabase.rpc("crm_calls_assign", { p_ids: ids.filter((n) => Number.isInteger(n)), p_rep: rep });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/sales", "layout");
  return { ok: true, n: Number(data ?? 0) };
}
