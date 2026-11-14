import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { SPECS, today } from "@/lib/forms/specs";
import { pickLists, type Sub } from "@/lib/forms/load";
import type { Data } from "@/lib/forms/engine";
import { TopBar } from "@/components/ui";
import { FormRunner } from "@/components/forms/form-runner";
import { SendLink } from "@/components/forms/send-link";

export const dynamic = "force-dynamic";

/** Fill in a form in the app. ?prf= links it to a price request (and fills in the customer); ?id= edits one. */
export default async function FillFormPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const sp = await searchParams;
  const spec = SPECS[key];
  if (!spec) notFound();
  const { supabase, profile } = await requireEmployee();
  const lists = await pickLists(supabase);
  let initial: Data = {};
  let prf: number | null = null;
  let company: string | null = sp.company ?? null;
  // Started from a price request: carry the customer over so nobody types it twice.
  if (sp.prf && /^\d+$/.test(sp.prf)) {
    const { data: r } = await supabase.from("price_requests").select("id, company_id, company_name, customer, created_by").eq("id", Number(sp.prf)).maybeSingle();
    if (r) {
      prf = r.id as number;
      company = (r.company_id as string | null) ?? company;
      const c = (r.customer ?? {}) as Record<string, string>;
      const name = `${c.contact_first ?? ""} ${c.contact_last ?? ""}`.trim();
      initial = key === "credit_app"
        ? { company_name: c.legal_name ?? r.company_name, ap_contact: name, ap_phone: c.phone, ap_email: c.email, own1_name: name, own1_phone: c.phone, own1_email: c.email }
        : { company_name: c.legal_name ?? r.company_name, purchaser: name, company_phone: c.phone, company_email: c.email, company_street: c.street, company_city: c.city,
            company_state: c.state, company_zip: c.zip, rep: r.created_by as string, ship_contact: name, ship_phone: c.phone, ship_email: c.email };
    }
  }
  if (sp.id && /^\d+$/.test(sp.id)) {
    const { data } = await supabase.from("form_submissions").select("*").eq("id", Number(sp.id)).maybeSingle();
    if (data) initial = (data as Sub).data as Data;
  }
  if (spec.group === "pulse") {
    const { data } = await supabase.from("form_submissions").select("data").eq("form_key", key).eq("submitted_by", profile.id).eq("for_day", sp.day ?? today()).maybeSingle();
    if (data) initial = (data as { data: Data }).data;
  }
  if (spec.group === "team") initial = { name: profile.full_name ?? "", email: profile.email, ...initial };
  if (key === "rma" || key === "spray_data") initial = { date: today(), ...(key === "spray_data" ? { tech: profile.id } : {}), ...initial };
  if (key === "account_setup" && !initial.rep) initial.rep = profile.id;
  for (const k of ["sign1_date", "g1_date", "g2_date", "sign2_date"]) if (!initial[k]) initial[k] = today();

  return (
    <main className="shell fx-shell">
      <TopBar title={spec.title} back={prf ? `/price-requests/n/${prf}` : "/forms"} />
      {spec.publicLink && !sp.id ? (
        <SendLink formKey={key as "credit_app" | "account_setup"} prf={prf} company={company} prefill={initial}
          email={String(initial.ap_email ?? initial.company_email ?? "")} name={String(initial.ap_contact ?? initial.purchaser ?? "")} title={spec.title} />
      ) : null}
      <FormRunner formKey={key} initial={initial} id={sp.id ? Number(sp.id) : undefined} staff people={lists.people} customers={lists.customers} prf={prf} company={company}
        forDay={spec.group === "pulse" ? sp.day ?? today() : undefined}
        after={prf && key === "credit_app" ? [{ label: "Next: Account Setup", href: `/forms/account_setup?prf=${prf}` }] : undefined} />
    </main>
  );
}
