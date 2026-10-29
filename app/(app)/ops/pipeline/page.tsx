import Link from "next/link";
import { CircleAlert, CircleCheck, Plus, Search } from "lucide-react";
import { requireOps, teamOf } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { CLOSED } from "@/lib/ops/defaults";
import { addressLine, memberName } from "@/lib/ops/crm";
import { TopBar } from "@/components/ui";
import { PipelineBoard, type BoardLead } from "./board";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile, ws } = await requireOps(opsCan.crm);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const mine = sp.who === "me";
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  let query = supabase
    .from("ops_leads")
    .select("id, number, title, stage, services, value_est, next_at, created_at, stage_changed_at, rep_id, source, lost_reason, customer:ops_customers(name, phone), property:ops_properties(street, city, state, zip)")
    .eq("company_id", ws.company.id)
    .or(`stage.not.in.(won,lost),stage_changed_at.gte.${since}`)
    .order("stage_changed_at", { ascending: false })
    .limit(800);
  if (mine) query = query.eq("rep_id", profile.id);
  const [{ data }, team] = await Promise.all([query, teamOf(supabase, ws.company.id)]);
  type Row = {
    id: string; number: number; title: string | null; stage: string; services: string[]; value_est: number | null; next_at: string | null; created_at: string; stage_changed_at: string; rep_id: string | null; source: string | null; lost_reason: string | null;
    customer: { name: string; phone: string | null } | null; property: { street: string | null; city: string | null; state: string | null; zip: string | null } | null;
  };
  const words = q.toLowerCase();
  const rows = ((data ?? []) as unknown as Row[]).filter((r) =>
    !words || [r.customer?.name, r.title, r.property?.street, r.property?.city, String(r.number), r.customer?.phone].some((x) => (x ?? "").toLowerCase().includes(words)),
  );
  const leads: BoardLead[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    name: r.customer?.name ?? "Customer",
    title: r.title,
    stage: r.stage,
    services: r.services ?? [],
    value: r.value_est === null ? null : Number(r.value_est),
    next_at: r.next_at,
    created_at: r.created_at,
    stage_changed_at: r.stage_changed_at,
    rep: r.rep_id ? memberName(team.find((m) => m.id === r.rep_id)) || null : null,
    where: r.property ? [r.property.city, r.property.state].filter(Boolean).join(", ") || addressLine(r.property) : "",
    source: r.source,
    lost_reason: r.lost_reason,
  }));
  const openCount = leads.filter((l) => !CLOSED.includes(l.stage)).length;

  return (
    <main className="shell wide ops-wide">
      <TopBar
        title="Leads"
        back="/ops"
        right={opsCan.editCrm(ws.role) ? <Link href="/ops/leads/new" className="btn sm"><Plus size={16} /> New lead</Link> : undefined}
      />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <form className="search" action="/ops/pipeline" style={{ flex: "1 1 240px" }}>
          <Search size={18} />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Search name, address, phone or #" aria-label="Search leads" />
          {mine ? <input type="hidden" name="who" value="me" /> : null}
        </form>
        {opsCan.allLeads(ws.role) ? (
          <div className="chips" role="tablist" aria-label="Whose leads">
            <Link href={`/ops/pipeline${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={`chip${!mine ? " on" : ""}`}>Everyone&apos;s</Link>
            <Link href={`/ops/pipeline?who=me${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${mine ? " on" : ""}`}>Mine</Link>
          </div>
        ) : null}
        <span className="tiny faint">{openCount} open · won and lost from the last 30 days</span>
      </div>
      <PipelineBoard leads={leads} stages={ws.settings.stages} lostReasons={ws.settings.lost_reasons} canMove={opsCan.editCrm(ws.role)} />
    </main>
  );
}
