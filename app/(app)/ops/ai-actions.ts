"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace, requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { digits } from "@/lib/ops/crm";
import { setupSteps, type SetupStep } from "@/lib/ops/setup";
import { signSay } from "@/lib/ops/ai/voice-server";
import { COACH_DONE, COACH_LAST } from "@/lib/ops/ai/fillers";
import type { LeadDraft, TaskDraft } from "@/lib/ops/ai/tools";

// What AMBIT Intelligence's cards save when the person taps Save. Saved with their own login, the same
// rules as the Leads screens (crm-actions.ts). AMBIT Intelligence itself never saves anything.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const t = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export type SaveLeadResult = { ok: true; id: string; number: number | null; path: string } | { ok: false; error: string; dup?: { id: string; name: string } };

export async function aiSaveLead(d: LeadDraft, opts: { useCustomer?: string; anyway?: boolean } = {}): Promise<SaveLeadResult> {
  const { supabase, profile, ws } = await requireOps(opsCan.editCrm);
  const co = ws.company.id;
  let customerId = t(opts.useCustomer, 40) ?? t(d.customer_id, 40);
  let propertyId: string | null = null;
  const street = t(d.street, 160);

  if (!customerId) {
    const company = t(d.company_name, 120);
    const first = t(d.first_name, 60);
    const last = t(d.last_name, 60);
    const isCompany = !!company && !first && !last;
    const name = isCompany ? company : [first, last].filter(Boolean).join(" ") || company;
    if (!name) return { ok: false, error: "Add the customer's name first." };
    const phone = t(d.phone, 40);
    const email = t(d.email, 160)?.toLowerCase() ?? null;
    if (!opts.anyway && (phone || email)) {
      const dg = digits(phone);
      const ors: string[] = [];
      if (email) ors.push(`email.ilike.${email.replace(/[,()]/g, "")}`);
      if (dg.length >= 7) ors.push(`phone.ilike.%${dg.slice(-4)}%`);
      if (ors.length) {
        const { data } = await supabase.from("ops_customers").select("id, name, phone, email").eq("company_id", co).or(ors.join(",")).limit(30);
        const dup = ((data ?? []) as { id: string; name: string; phone: string | null; email: string | null }[]).find(
          (c) => (email && c.email?.toLowerCase() === email) || (dg.length >= 7 && digits(c.phone).endsWith(dg.slice(-10))),
        );
        if (dup) return { ok: false, error: `${dup.name} already has that ${email && dup.email?.toLowerCase() === email ? "email" : "phone number"}.`, dup: { id: dup.id, name: dup.name } };
      }
    }
    const { data: cust, error } = await supabase
      .from("ops_customers")
      .insert({
        company_id: co,
        kind: isCompany ? "company" : "person",
        name,
        first_name: isCompany ? null : first,
        last_name: isCompany ? null : last,
        company_name: company,
        email,
        phone,
        source: t(d.source, 60),
        price_level: isCompany ? "builder" : "retail",
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error || !cust) return { ok: false, error: error?.message ?? "Couldn't save the customer." };
    customerId = cust.id as string;
  }

  if (street) {
    const { data: prop } = await supabase
      .from("ops_properties")
      .insert({ company_id: co, customer_id: customerId, street, city: t(d.city, 80), state: t(d.state, 2)?.toUpperCase() ?? null, zip: t(d.zip, 10) })
      .select("id")
      .single();
    propertyId = (prop?.id as string) ?? null;
  } else {
    const { data: prop } = await supabase.from("ops_properties").select("id").eq("customer_id", customerId).order("created_at").limit(1).maybeSingle();
    propertyId = (prop?.id as string) ?? null;
  }

  const { data: lead, error } = await supabase
    .from("ops_leads")
    .insert({
      company_id: co,
      customer_id: customerId,
      property_id: propertyId,
      title: t(d.title, 140),
      stage: "new",
      source: t(d.source, 60),
      services: Array.isArray(d.services) ? d.services.map((x) => String(x).slice(0, 60)).slice(0, 10) : [],
      rep_id: ws.role === "sales" ? profile.id : null,
      value_est: typeof d.value_est === "number" && d.value_est >= 0 ? Math.round(d.value_est * 100) / 100 : null,
      notes: t(d.notes, 4000),
      next_at: d.next_at && DATE.test(d.next_at) ? d.next_at : null,
      created_by: profile.id,
    })
    .select("id, number")
    .single();
  if (error || !lead) return { ok: false, error: error?.message ?? "Couldn't save the lead." };
  revalidatePath("/ops/pipeline");
  revalidatePath("/ops");
  return { ok: true, id: lead.id as string, number: (lead.number as number) ?? null, path: `/ops/leads/${lead.id}` };
}

export async function aiSaveTask(d: TaskDraft): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, profile, ws } = await requireOps(opsCan.editCrm);
  const body = t(d.body, 4000);
  if (!body) return { ok: false, error: "The reminder is empty." };
  const { error } = await supabase.from("ops_notes").insert({
    company_id: ws.company.id,
    lead_id: t(d.lead_id, 40),
    customer_id: t(d.customer_id, 40),
    kind: "task",
    body,
    due_on: d.due_on && DATE.test(d.due_on) ? d.due_on : null,
    assigned_to: profile.id,
    created_by: profile.id,
    created_by_name: profile.full_name || profile.email,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ops");
  if (d.lead_id) revalidatePath(`/ops/leads/${d.lead_id}`);
  return { ok: true };
}

export type CoachStep = SetupStep & { say: { todo: { text: string; sig: string }; done: { text: string; sig: string } } };

/** For the guide's coach: which setup steps are done right now, and what it says on each (signed for the voice). */
export async function guideSteps(): Promise<CoachStep[]> {
  const s = await getWorkspace();
  if (!s) return [];
  const steps = await setupSteps(s.supabase, s.ws);
  const left = steps.filter((x) => !x.done).length;
  const line = (text: string) => ({ text, sig: signSay(text) });
  return steps.map((x) => ({ ...x, say: { todo: line(`${x.label}. ${x.coach}`), done: line(left ? COACH_DONE : COACH_LAST) } }));
}
