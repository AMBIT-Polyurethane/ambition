import Link from "next/link";
import { CircleAlert, FileSignature, Ruler, SquareKanban } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { CLOSED, stageName } from "@/lib/ops/defaults";
import { addressLine } from "@/lib/ops/crm";
import { dateShort } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { createQuote } from "../actions";
import { QuoteStart } from "./quote-start";
import type { CustomerHit } from "../../crm-actions";

export const metadata = { title: "New quote" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Start a quote: for a lead (most common), a customer, or from a takeoff. */
export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.quote);
  const leadId = sp.lead && UUID.test(sp.lead) ? sp.lead : null;
  const takeoffId = sp.takeoff && UUID.test(sp.takeoff) ? sp.takeoff : null;
  const [{ data: lead }, { data: takeoff }, { data: takeoffs }, { data: leads }] = await Promise.all([
    leadId
      ? supabase.from("ops_leads").select("id, number, title, stage, customer:ops_customers(id, name, phone, email, properties:ops_properties(id, label, street, city, state, zip)), property:ops_properties(street, city, state, zip)").eq("id", leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    takeoffId ? supabase.from("takeoffs").select("id, name, customer, address, lead_id, ops_customer_id").eq("id", takeoffId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("takeoffs").select("id, name, customer, updated_at").eq("ops_company_id", ws.company.id).order("updated_at", { ascending: false }).limit(30),
    leadId
      ? Promise.resolve({ data: [] })
      : supabase.from("ops_leads").select("id, number, title, stage, customer:ops_customers(name)").eq("company_id", ws.company.id).not("stage", "in", `(${CLOSED.join(",")})`).order("stage_changed_at", { ascending: false }).limit(12),
  ]);
  type LeadRow = { id: string; number: number; title: string | null; stage: string; customer: CustomerHit | null; property: { street: string | null; city: string | null; state: string | null; zip: string | null } | null };
  const L = lead as unknown as LeadRow | null;
  const T = takeoff as { id: string; name: string; customer: string | null; address: string | null; lead_id: string | null; ops_customer_id: string | null } | null;
  const tos = (takeoffs ?? []) as { id: string; name: string; customer: string | null; updated_at: string }[];
  const open = (leads ?? []) as unknown as { id: string; number: number; title: string | null; stage: string; customer: { name: string } | null }[];

  return (
    <main className="shell">
      <TopBar title="New quote" back={L ? `/ops/leads/${L.id}` : "/ops/quotes"} />
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      {L ? (
        <form action={createQuote} className="card col" style={{ gap: 12 }}>
          <input type="hidden" name="lead_id" value={L.id} />
          <span className="tiny faint">Quote for lead #{L.number}</span>
          <b style={{ fontSize: 18 }}>{L.customer?.name ?? "Customer"}</b>
          <span className="small muted">{[L.title, addressLine(L.property)].filter(Boolean).join(" · ") || stageName(ws.settings, L.stage)}</span>
          <TakeoffPick takeoffs={tos} picked={takeoffId} />
          <Submit className="btn" pendingText="Starting…"><FileSignature size={17} /> Start the quote</Submit>
        </form>
      ) : (
        <>
          {open.length ? (
            <section className="col" style={{ gap: 8 }}>
              <div className="eyebrow">For one of your open leads</div>
              <div className="list">
                {open.map((l) => (
                  <Link key={l.id} href={`/ops/quotes/new?lead=${l.id}${takeoffId ? `&takeoff=${takeoffId}` : ""}`} className="item">
                    <span className="ops-q-ic" aria-hidden="true"><SquareKanban size={17} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t ellipsis">{l.customer?.name ?? "Customer"}</div>
                      <div className="s ellipsis">#{l.number}{l.title ? ` · ${l.title}` : ""} · {stageName(ws.settings, l.stage)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">{open.length ? "Or for any customer" : "For a customer"}</div>
            <QuoteStart takeoffs={tos} takeoffId={takeoffId} takeoffName={T?.name ?? null} />
          </section>
        </>
      )}
      <p className="tiny faint" style={{ margin: 0 }}>
        <Ruler size={12} style={{ verticalAlign: -2 }} /> Measuring plans first? <Link href="/takeoff">Start a takeoff</Link>, then come back and pick it here{tos.length ? ` (last one: ${tos[0].name}, ${dateShort(tos[0].updated_at)})` : ""}.
      </p>
    </main>
  );
}

function TakeoffPick({ takeoffs, picked }: { takeoffs: { id: string; name: string; customer: string | null }[]; picked: string | null }) {
  if (!takeoffs.length) return null;
  return (
    <label className="field">
      <span className="label">Fill it from a takeoff (optional)</span>
      <select className="select" name="takeoff_id" defaultValue={picked ?? ""}>
        <option value="">No, I&apos;ll add the work myself</option>
        {takeoffs.map((t) => <option key={t.id} value={t.id}>{t.name}{t.customer ? ` · ${t.customer}` : ""}</option>)}
      </select>
    </label>
  );
}
