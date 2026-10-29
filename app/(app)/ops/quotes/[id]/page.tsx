import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireOps, teamOf } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { loadProducts, loadQuote } from "@/lib/ops/quotes";
import { currentOrigin } from "@/lib/origin";
import { canEmailCustomers } from "@/lib/email";
import { QuoteEditor } from "./editor";

export const metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, profile, ws } = await requireOps(opsCan.crm);
  const loaded = await loadQuote(supabase, id);
  if (!loaded) notFound();
  const q = loaded.quote;
  const [products, team, { data: cust }, { data: lead }, { data: packages }, { data: takeoffs }] = await Promise.all([
    loadProducts(supabase, ws.company.id),
    teamOf(supabase, ws.company.id),
    supabase.from("ops_customers").select("id, name, phone, email, kind, price_level, tax_exempt, properties:ops_properties(id, label, street, city, state, zip)").eq("id", q.customer_id).maybeSingle(),
    q.lead_id ? supabase.from("ops_leads").select("id, number, title, stage").eq("id", q.lead_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("ops_packages").select("id, name, lines").eq("company_id", ws.company.id).order("name"),
    supabase.from("takeoffs").select("id, name, customer, updated_at").eq("ops_company_id", ws.company.id).order("updated_at", { ascending: false }).limit(30),
  ]);
  const origin = await currentOrigin();
  const s = ws.settings;
  return (
    <main className="shell ops-wide q-shell">
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <QuoteEditor
        quote={q}
        options={loaded.options}
        lines={loaded.lines}
        products={products}
        customer={cust as never}
        lead={(lead as { id: string; number: number; title: string | null; stage: string } | null) ?? null}
        settings={{ labor: s.labor, builder_margin: s.builder_margin, work_areas: s.work_areas, min_job: s.min_job, quote_days: s.quote_days, target_margin: s.target_margin, floor_margin: s.floor_margin }}
        reps={team.filter((m) => ["owner", "office", "sales", "dispatcher"].includes(m.ops_role ?? "")).map((m) => ({ id: m.id, name: m.full_name || m.email }))}
        packages={((packages ?? []) as { id: string; name: string; lines: unknown[] }[]).map((p) => ({ id: p.id, name: p.name, lines: p.lines as never }))}
        takeoffs={(takeoffs ?? []) as { id: string; name: string; customer: string | null; updated_at: string }[]}
        link={q.public_token ? `${origin}/p/${q.public_token}` : null}
        can={{ edit: opsCan.quote(ws.role) && q.status !== "signed", approve: opsCan.approve(ws.role), remove: opsCan.manage(ws.role), order: opsCan.order(ws.role) }}
        emailReady={canEmailCustomers()}
        me={profile.id}
      />
    </main>
  );
}
