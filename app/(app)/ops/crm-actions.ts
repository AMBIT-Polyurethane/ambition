"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { CLOSED } from "@/lib/ops/defaults";
import { digits } from "@/lib/ops/crm";

// AMBIT-OPS CRM: everything is saved with the person's own login, so the database's walls apply
// (their company only; a sales rep only their own leads).

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string, max = 400) => s(f, k).slice(0, max) || null;
const money = (f: FormData, k: string) => {
  const v = s(f, k).replace(/[$,\s]/g, "");
  return v && /^\d+(\.\d{1,2})?$/.test(v) ? Number(v) : null;
};
const date = (f: FormData, k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s(f, k)) ? s(f, k) : null);
const go = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);

export type FormState = { error?: string; dup?: { id: string; name: string } } | null;

function nameParts(f: FormData) {
  const kind = s(f, "kind") === "company" ? "company" : "person";
  const first = n(f, "first_name", 60);
  const last = n(f, "last_name", 60);
  const company = n(f, "company_name", 120);
  const name = kind === "company" ? company : [first, last].filter(Boolean).join(" ") || null;
  return { kind, first, last, company, name };
}

/** Is this phone or email already one of their customers? */
async function findDup(supabase: Awaited<ReturnType<typeof requireOps>>["supabase"], co: string, phone: string | null, email: string | null) {
  const d = digits(phone);
  const ors: string[] = [];
  if (email) ors.push(`email.ilike.${email.replace(/[,()]/g, "")}`);
  if (d.length >= 7) ors.push(`phone.ilike.%${d.slice(-4)}%`);
  if (!ors.length) return null;
  const { data } = await supabase.from("ops_customers").select("id, name, phone, email").eq("company_id", co).or(ors.join(",")).limit(30);
  return ((data ?? []) as { id: string; name: string; phone: string | null; email: string | null }[]).find(
    (c) => (email && c.email?.toLowerCase() === email.toLowerCase()) || (d.length >= 7 && digits(c.phone).endsWith(d.slice(-10))),
  ) ?? null;
}

async function insertCustomer(f: FormData) {
  const ctx = await requireOps(opsCan.editCrm);
  const { supabase, profile, ws } = ctx;
  const p = nameParts(f);
  if (!p.name) return { ctx, error: p.kind === "company" ? "Type the company name." : "Type the customer's name." } as const;
  const phone = n(f, "phone", 40);
  const email = n(f, "email", 160)?.toLowerCase() ?? null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ctx, error: "That email doesn't look right." } as const;
  if (s(f, "confirm_dup") !== "1") {
    const dup = await findDup(supabase, ws.company.id, phone, email);
    if (dup) return { ctx, error: `${dup.name} already has that ${email && dup.email?.toLowerCase() === email ? "email" : "phone number"}.`, dup: { id: dup.id, name: dup.name } } as const;
  }
  const { data: cust, error } = await supabase
    .from("ops_customers")
    .insert({
      company_id: ws.company.id,
      kind: p.kind,
      name: p.name,
      first_name: p.kind === "person" ? p.first : null,
      last_name: p.kind === "person" ? p.last : null,
      company_name: p.kind === "company" ? p.company : null,
      email,
      phone,
      phone2: n(f, "phone2", 40),
      notes: n(f, "customer_notes", 2000),
      source: n(f, "source", 60),
      price_level: s(f, "price_level") === "builder" ? "builder" : "retail",
      tax_exempt: f.get("tax_exempt") === "on",
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !cust) return { ctx, error: error?.message ?? "Could not save the customer." } as const;
  let propertyId: string | null = null;
  if (s(f, "street")) {
    const { data: prop } = await supabase
      .from("ops_properties")
      .insert({
        company_id: ws.company.id,
        customer_id: cust.id,
        label: n(f, "label", 60),
        street: n(f, "street", 160),
        city: n(f, "city", 80),
        state: n(f, "state", 2)?.toUpperCase() ?? null,
        zip: n(f, "zip", 10),
        gate_code: n(f, "gate_code", 60),
      })
      .select("id")
      .single();
    propertyId = (prop?.id as string) ?? null;
  }
  return { ctx, customerId: cust.id as string, propertyId } as const;
}

export async function createCustomer(_prev: FormState, f: FormData): Promise<FormState> {
  const r = await insertCustomer(f);
  if ("error" in r) return { error: r.error, dup: "dup" in r ? r.dup : undefined };
  revalidatePath("/ops/customers");
  if (s(f, "then") === "lead") redirect(`/ops/leads/new?customer=${r.customerId}${r.propertyId ? `&property=${r.propertyId}` : ""}`);
  redirect(`/ops/customers/${r.customerId}?msg=${encodeURIComponent("Customer added.")}`);
}

export async function createLead(_prev: FormState, f: FormData): Promise<FormState> {
  let customerId = s(f, "customer_id");
  let propertyId = s(f, "property_id") || null;
  let ctx = await requireOps(opsCan.editCrm);
  if (!customerId) {
    const r = await insertCustomer(f);
    if ("error" in r) return { error: r.error, dup: "dup" in r ? r.dup : undefined };
    customerId = r.customerId;
    propertyId = r.propertyId;
    ctx = r.ctx;
  } else if (!propertyId && s(f, "street")) {
    const { data: prop } = await ctx.supabase
      .from("ops_properties")
      .insert({ company_id: ctx.ws.company.id, customer_id: customerId, street: n(f, "street", 160), city: n(f, "city", 80), state: n(f, "state", 2)?.toUpperCase() ?? null, zip: n(f, "zip", 10) })
      .select("id")
      .single();
    propertyId = (prop?.id as string) ?? null;
  }
  const { supabase, profile, ws } = ctx;
  const services = f.getAll("services").map(String).filter(Boolean).slice(0, 10);
  // A sales rep's own leads are theirs unless they pick someone else.
  const rep = s(f, "rep_id") || (ws.role === "sales" ? profile.id : null);
  const { data: lead, error } = await supabase
    .from("ops_leads")
    .insert({
      company_id: ws.company.id,
      customer_id: customerId,
      property_id: propertyId,
      location_id: s(f, "location_id") || null,
      title: n(f, "title", 140),
      stage: "new",
      source: n(f, "lead_source", 60) ?? n(f, "source", 60),
      services,
      rep_id: rep,
      value_est: money(f, "value_est"),
      notes: n(f, "notes", 4000),
      next_at: date(f, "next_at"),
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !lead) return { error: error?.message ?? "Could not save the lead." };
  revalidatePath("/ops/pipeline");
  redirect(`/ops/leads/${lead.id}?msg=${encodeURIComponent("Lead added.")}`);
}

export async function updateLead(f: FormData) {
  const { supabase } = await requireOps(opsCan.editCrm);
  const id = s(f, "id");
  const { error } = await supabase
    .from("ops_leads")
    .update({
      title: n(f, "title", 140),
      services: f.getAll("services").map(String).filter(Boolean).slice(0, 10),
      source: n(f, "lead_source", 60),
      rep_id: s(f, "rep_id") || null,
      value_est: money(f, "value_est"),
      next_at: date(f, "next_at"),
      property_id: s(f, "property_id") || null,
      location_id: s(f, "location_id") || null,
      notes: n(f, "notes", 4000),
    })
    .eq("id", id);
  if (error) go(`/ops/leads/${id}`, "err", error.message);
  revalidatePath(`/ops/leads/${id}`);
  go(`/ops/leads/${id}`, "msg", "Saved.");
}

/** Move a lead to another stage (drag on the board, or the stage buttons). Lost needs a reason. */
export async function moveLead(id: string, stage: string, lostReason?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { supabase, ws } = await requireOps(opsCan.editCrm);
  if (!ws.settings.stages.some((x) => x.key === stage)) return { ok: false, error: "That stage doesn't exist anymore." };
  if (stage === "lost" && !lostReason?.trim()) return { ok: false, error: "Pick why it was lost." };
  const { error } = await supabase
    .from("ops_leads")
    .update({ stage, lost_reason: stage === "lost" ? lostReason!.trim().slice(0, 120) : null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ops/pipeline");
  revalidatePath(`/ops/leads/${id}`);
  return { ok: true };
}

export async function moveLeadForm(f: FormData) {
  const id = s(f, "id");
  const reason = [s(f, "lost_reason"), s(f, "lost_note")].filter(Boolean).join(": ") || null;
  const r = await moveLead(id, s(f, "stage"), reason);
  if (!r.ok) go(`/ops/leads/${id}`, "err", r.error ?? "Couldn't move it.");
  go(`/ops/leads/${id}`, "msg", CLOSED.includes(s(f, "stage")) ? (s(f, "stage") === "won" ? "Marked won." : "Marked lost.") : "Moved.");
}

export async function deleteLead(f: FormData) {
  const { supabase } = await requireOps(opsCan.remove);
  const { error } = await supabase.from("ops_leads").delete().eq("id", s(f, "id"));
  if (error) go(`/ops/leads/${s(f, "id")}`, "err", error.message);
  revalidatePath("/ops/pipeline");
  go("/ops/pipeline", "msg", "Lead deleted.");
}

/** A note, call, text or email on a lead or customer, or a task with a due date. */
export async function addNote(f: FormData) {
  const { supabase, profile, ws } = await requireOps(opsCan.editCrm);
  const leadId = s(f, "lead_id") || null;
  const customerId = s(f, "customer_id") || null;
  const back = leadId ? `/ops/leads/${leadId}` : `/ops/customers/${customerId}`;
  const body = s(f, "body").slice(0, 4000);
  if (!body) go(back, "err", "Type the note first.");
  const task = s(f, "kind") === "task";
  const kind = task ? "task" : (["note", "call", "text", "email"].includes(s(f, "kind")) ? s(f, "kind") : "note");
  const { error } = await supabase.from("ops_notes").insert({
    company_id: ws.company.id,
    lead_id: leadId,
    customer_id: customerId,
    kind,
    body,
    due_on: task ? date(f, "due_on") : null,
    assigned_to: task ? s(f, "assigned_to") || profile.id : null,
    created_by: profile.id,
    created_by_name: profile.full_name || profile.email,
  });
  if (error) go(back, "err", error.message);
  revalidatePath(back);
  revalidatePath("/ops");
  go(back, "msg", task ? "Task added." : "Saved to the timeline.");
}

export async function finishTask(f: FormData) {
  const { supabase } = await requireOps(opsCan.editCrm);
  const back = s(f, "back") || "/ops";
  const done = s(f, "done") !== "0";
  await supabase.from("ops_notes").update({ done_at: done ? new Date().toISOString() : null }).eq("id", s(f, "id"));
  revalidatePath(back);
  revalidatePath("/ops");
  redirect(back);
}

export async function deleteNote(f: FormData) {
  const { supabase } = await requireOps(opsCan.editCrm);
  const back = s(f, "back") || "/ops";
  await supabase.from("ops_notes").delete().eq("id", s(f, "id"));
  revalidatePath(back);
  redirect(back);
}

export async function updateCustomer(f: FormData) {
  const { supabase } = await requireOps(opsCan.editCrm);
  const id = s(f, "id");
  const p = nameParts(f);
  if (!p.name) go(`/ops/customers/${id}`, "err", "The customer needs a name.");
  const email = n(f, "email", 160)?.toLowerCase() ?? null;
  const { error } = await supabase
    .from("ops_customers")
    .update({
      kind: p.kind,
      name: p.name,
      first_name: p.kind === "person" ? p.first : null,
      last_name: p.kind === "person" ? p.last : null,
      company_name: p.kind === "company" ? p.company : null,
      email,
      phone: n(f, "phone", 40),
      phone2: n(f, "phone2", 40),
      source: n(f, "source", 60),
      notes: n(f, "customer_notes", 2000),
      price_level: s(f, "price_level") === "builder" ? "builder" : "retail",
      tax_exempt: f.get("tax_exempt") === "on",
    })
    .eq("id", id);
  if (error) go(`/ops/customers/${id}`, "err", error.message);
  revalidatePath(`/ops/customers/${id}`);
  go(`/ops/customers/${id}`, "msg", "Saved.");
}

export async function saveProperty(f: FormData) {
  const { supabase, ws } = await requireOps(opsCan.editCrm);
  const customerId = s(f, "customer_id");
  const id = s(f, "id");
  if (!s(f, "street")) go(`/ops/customers/${customerId}`, "err", "Type the street address.");
  const row = {
    label: n(f, "label", 60),
    street: n(f, "street", 160),
    city: n(f, "city", 80),
    state: n(f, "state", 2)?.toUpperCase() ?? null,
    zip: n(f, "zip", 10),
    gate_code: n(f, "gate_code", 60),
    notes: n(f, "property_notes", 1000),
  };
  const { error } = id
    ? await supabase.from("ops_properties").update(row).eq("id", id)
    : await supabase.from("ops_properties").insert({ ...row, company_id: ws.company.id, customer_id: customerId });
  if (error) go(`/ops/customers/${customerId}`, "err", error.message);
  revalidatePath(`/ops/customers/${customerId}`);
  go(`/ops/customers/${customerId}`, "msg", id ? "Address saved." : "Address added.");
}

export async function deleteProperty(f: FormData) {
  const { supabase } = await requireOps(opsCan.remove);
  const customerId = s(f, "customer_id");
  await supabase.from("ops_properties").delete().eq("id", s(f, "id"));
  revalidatePath(`/ops/customers/${customerId}`);
  go(`/ops/customers/${customerId}`, "msg", "Address removed.");
}

export async function deleteCustomer(f: FormData) {
  const { supabase } = await requireOps(opsCan.remove);
  const id = s(f, "id");
  const { count } = await supabase.from("ops_leads").select("id", { count: "exact", head: true }).eq("customer_id", id);
  if ((count ?? 0) > 0 && s(f, "sure") !== "1") go(`/ops/customers/${id}`, "err", "This customer has leads. Delete those first, or tick \"Delete their leads too\".");
  const { error } = await supabase.from("ops_customers").delete().eq("id", id);
  if (error) go(`/ops/customers/${id}`, "err", error.message);
  revalidatePath("/ops/customers");
  go("/ops/customers", "msg", "Customer deleted.");
}

// ------------------------------------------------------------------ spreadsheet import
export type ImportRow = { name: string; kind: "person" | "company"; first_name?: string; last_name?: string; company_name?: string; email?: string; phone?: string; street?: string; city?: string; state?: string; zip?: string; notes?: string; source?: string };

/** Phone numbers (last 10 digits) and emails already in their customer list, to warn about repeats. */
export async function existingContacts(): Promise<{ phones: string[]; emails: string[] }> {
  const { supabase, ws } = await requireOps(opsCan.manage);
  const { data } = await supabase.from("ops_customers").select("phone, email").eq("company_id", ws.company.id).limit(20000);
  const rows = (data ?? []) as { phone: string | null; email: string | null }[];
  return {
    phones: rows.map((r) => digits(r.phone).slice(-10)).filter((d) => d.length >= 7),
    emails: rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean),
  };
}

export async function importCustomers(rows: ImportRow[]): Promise<{ ok: boolean; error?: string; batch?: string; customers?: number; properties?: number }> {
  const { supabase } = await requireOps(opsCan.manage);
  const clean = rows.slice(0, 5000).map((r) => ({ ...r, name: (r.name ?? "").trim().slice(0, 120) })).filter((r) => r.name);
  if (!clean.length) return { ok: false, error: "No rows with a name to import." };
  const { data, error } = await supabase.rpc("ops_import_customers", { p_rows: clean });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ops/customers");
  const d = data as { batch: string; customers: number; properties: number };
  return { ok: true, batch: d.batch, customers: d.customers, properties: d.properties };
}

export async function undoImport(f: FormData) {
  const { supabase } = await requireOps(opsCan.manage);
  const { data, error } = await supabase.rpc("ops_undo_import", { p_batch: s(f, "batch") });
  if (error) go("/ops/customers", "err", error.message);
  revalidatePath("/ops/customers");
  go("/ops/customers", "msg", `Import undone: ${data ?? 0} customers removed.`);
}

export type CustomerHit = { id: string; name: string; phone: string | null; email: string | null; properties: { id: string; label: string | null; street: string | null; city: string | null; state: string | null; zip: string | null }[] };

/** Type-to-search their customers (name, phone, email or street). */
export async function searchCustomers(q: string): Promise<CustomerHit[]> {
  const { supabase, ws } = await requireOps(opsCan.editCrm);
  const t = q.trim().replace(/[\\%_,()]/g, " ").slice(0, 60);
  if (t.length < 2) return [];
  const like = `%${t}%`;
  const d = digits(t);
  const ors = [`name.ilike.${like}`, `email.ilike.${like}`];
  if (d.length >= 3) ors.push(`phone.ilike.%${d.slice(-4)}%`);
  const [{ data: byCust }, { data: byProp }] = await Promise.all([
    supabase.from("ops_customers").select("id").eq("company_id", ws.company.id).or(ors.join(",")).limit(12),
    supabase.from("ops_properties").select("customer_id").eq("company_id", ws.company.id).ilike("street", like).limit(12),
  ]);
  const ids = [...new Set([...(byCust ?? []).map((r) => r.id as string), ...(byProp ?? []).map((r) => r.customer_id as string)])].slice(0, 12);
  if (!ids.length) return [];
  const { data } = await supabase
    .from("ops_customers")
    .select("id, name, phone, email, properties:ops_properties(id, label, street, city, state, zip)")
    .in("id", ids)
    .order("name");
  return (data ?? []) as unknown as CustomerHit[];
}

export async function getCustomer(id: string): Promise<CustomerHit | null> {
  const { supabase } = await requireOps(opsCan.editCrm);
  const { data } = await supabase.from("ops_customers").select("id, name, phone, email, properties:ops_properties(id, label, street, city, state, zip)").eq("id", id).maybeSingle();
  return (data as unknown as CustomerHit) ?? null;
}
