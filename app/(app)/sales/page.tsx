import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BellRing, CalendarClock, Info, KanbanSquare } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canSalesAll, canSalesHub } from "@/lib/access";
import { claudeReady } from "@/lib/ai/claude";
import { buildAlerts, crmCustomers, crmLeads, crmTasks, historyMeta, repList, todayCentral } from "@/lib/crm";
import { readNote, type Brief } from "@/lib/crm-ai";
import { STAGES, kmoney, monthLabels } from "@/lib/crm-shared";
import { dateShort } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { ColumnChart } from "@/components/inventory/charts";
import { SalesNav } from "@/components/sales/sales-nav";
import { BriefCard } from "@/components/sales/ai-cards";
import { TaskList } from "@/components/sales/activity";
import { CustomerTable } from "@/components/sales/customer-table";
import { RepPicker } from "@/components/sales/rep-picker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales hub" };

/** A rep's hub: their customers' health, today's briefing, alerts, follow-ups and new customers. */
export default async function SalesHubPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canSalesHub(profile)) redirect("/");
  const all = canSalesAll(profile);
  const admin = profile.role === "admin";
  const reps = all ? await repList(supabase) : [];
  // Admins: pick a rep (or everyone). Starts on their own book if they have one, else everyone.
  const owns = all ? (await supabase.from("companies").select("id", { count: "exact", head: true }).eq("sales_rep_id", profile.id)).count ?? 0 : 1;
  const pick = all ? (sp.rep ?? (owns ? profile.id : "all")) : profile.id;
  const who = pick === "all" ? null : pick;
  const today = todayCentral();

  const [{ rows, error }, tasks, leads, meta, brief, goals, est] = await Promise.all([
    crmCustomers(supabase, who),
    crmTasks(supabase, who),
    crmLeads(supabase, who),
    historyMeta(supabase),
    readNote<Brief>(supabase, "brief", `${who ?? "all"}:${today}`),
    who ? supabase.from("sales_goals").select("amount").eq("person_id", who) : supabase.from("sales_goals").select("amount"),
    (() => {
      let q = supabase.from("estimates").select("total", { count: "exact" }).in("status", ["needs_freight", "ready", "sent"]);
      if (who) q = q.eq("created_by", who);
      return q;
    })(),
  ]);
  const name = who ? reps.find((r) => r.id === who)?.name ?? (who === profile.id ? profile.full_name : "Rep") : "Everyone";

  const goal = ((goals.data ?? []) as { amount: number }[]).reduce((s, g) => s + Number(g.amount), 0);
  const mtd = rows.reduce((s, c) => s + c.sales_mtd, 0);
  const active = rows.filter((c) => c.days_since !== null && c.days_since <= 90).length;
  const risk = rows.filter((c) => c.status === "at_risk").length;
  const watch = rows.filter((c) => c.status === "watch").length;
  const fresh = rows.filter((c) => c.status === "new").length;
  const due = tasks.filter((t) => t.due_on && t.due_on <= today).length;
  const estN = est.count ?? 0;
  const estTotal = ((est.data ?? []) as { total: number | null }[]).reduce((s, e) => s + Number(e.total ?? 0), 0);
  const openLeads = leads.filter((l) => l.stage !== "lost" && l.stage !== "repeat");
  const alerts = buildAlerts(rows, tasks, leads, today);
  const names = Object.fromEntries(rows.map((c) => [c.id, c.name]));
  const labels = monthLabels();
  const months = labels.map((label, i) => ({ label, values: [rows.reduce((s, c) => s + (c.monthly[i] ?? 0), 0)] }));
  // How far through the month we are, to judge pace against the goal.
  const d = new Date(`${today}T12:00:00`);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const pace = goal ? (mtd / goal) / (d.getDate() / dim) : null;

  const tile = (label: React.ReactNode, value: string, sub: string, tone = "", href?: string) => {
    const body = (<><span className="l">{label}</span><b>{value}</b><span className="s">{sub}</span></>);
    return href ? <Link href={href} className={`ihub-kpi${tone ? ` ${tone}` : ""}`}>{body}</Link> : <div className={`ihub-kpi${tone ? ` ${tone}` : ""}`}>{body}</div>;
  };

  return (
    <main className="shell full crm">
      <TopBar title={who === profile.id ? "My sales hub" : `Sales hub: ${name}`} right={all ? <RepPicker reps={reps} value={pick} me={profile.id} /> : undefined} />
      <SalesNav on="hub" all={all} admin={admin} />
      {error ? <div className="alert warn small">{error}</div> : null}
      {!meta?.through_date ? (
        <div className="alert small" role="note">
          <Info size={16} style={{ flex: "none", marginTop: 2 }} />
          <span>
            Sales history from QuickBooks isn&apos;t loaded yet, so customers only show orders placed in A.I. (since late October). Health, rhythm and trends get much better once it is.
            {admin ? <> <Link href="/sales/import">Import it now</Link>.</> : " Ask an admin to import it."}
          </span>
        </div>
      ) : null}

      <div className="ihub-kpis">
        {tile("Sales this month", kmoney(mtd), goal ? `${Math.round((mtd / goal) * 100)}% of the ${kmoney(goal)} goal${pace !== null ? ` · ${pace >= 1 ? "on pace" : "behind pace"}` : ""}` : "No goal set", pace !== null && pace < 0.85 ? "warn" : "")}
        {tile("Active customers", String(active), `of ${rows.length} ordered in the last 90 days`)}
        {tile("Need attention", String(risk + watch), `${risk} at risk · ${watch} to watch`, risk ? "warn" : "")}
        {tile("New customers", String(fresh), "First order in the last 60 days")}
        {tile("Follow-ups due", String(due), `${tasks.length} open in all`, due ? "warn" : "")}
        {tile("Open estimates", String(estN), estN ? `${kmoney(estTotal)} waiting to turn into orders` : "None open", "", "/estimates")}
        {tile("New-customer pipeline", String(openLeads.length), openLeads.length ? `${openLeads.filter((l) => l.stage === "approved").length} approved, ready for a first order` : "Add your first lead", "", "/sales/pipeline")}
        {tile("12 months", kmoney(rows.reduce((s, c) => s + c.sales_12m, 0)), meta?.through_date ? `QuickBooks through ${dateShort(meta.through_date)}, then A.I.` : "A.I. orders only")}
      </div>

      <div className="ihub-grid">
        <BriefCard rep={pick} initial={brief?.body ?? null} at={brief?.created_at ?? null} aiReady={claudeReady()} />
        <section className="card2" aria-label="Alerts">
          <div className="card2-h"><b><BellRing size={17} aria-hidden /> Alerts</b><span className="small faint">{alerts.length}</span></div>
          <div className="crm-pad">
            {alerts.length ? (
              <ul className="crm-alerts">
                {alerts.slice(0, 12).map((a, i) => (
                  <li key={i} className={a.tone}>
                    <Link href={a.href}>
                      <b className="small">{a.title}</b>
                      <span className="tiny muted">{a.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>Nothing needs you right now.</p>
            )}
            {alerts.length > 12 ? <span className="tiny faint">{alerts.length - 12} more: see Needs attention below.</span> : null}
          </div>
        </section>
        <section className="card2" aria-label="Follow-ups">
          <div className="card2-h"><b><CalendarClock size={17} aria-hidden /> Follow-ups</b><span className="small faint">{tasks.length} open</span></div>
          <div className="crm-pad"><TaskList tasks={tasks.slice(0, 15)} names={names} today={today} /></div>
        </section>
        <section className="card2" aria-label="New-customer pipeline">
          <div className="card2-h"><b><KanbanSquare size={17} aria-hidden /> New-customer pipeline</b><Link href="/sales/pipeline" className="small">Open <ArrowRight size={13} aria-hidden /></Link></div>
          <div className="crm-pad crm-funnel">
            {STAGES.map((s) => {
              const n = leads.filter((l) => l.stage === s.key).length;
              const max = Math.max(1, ...STAGES.map((x) => leads.filter((l) => l.stage === x.key).length));
              return (
                <div key={s.key} className="crm-funnel-r">
                  <span className="small">{s.label}</span>
                  <span className="crm-funnel-bar" aria-hidden><i style={{ width: `${(n / max) * 100}%` }} /></span>
                  <b className="small">{n}</b>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card2 ihub-card wide" aria-label="Sales by month">
          <div className="ihub-card-h"><b>Sales by month</b><span>{name === "Everyone" ? "Every customer" : `${name}'s customers`} · last 12 months</span></div>
          <ColumnChart rows={months} series={[{ key: "sales", label: "Sales" }]} caption="Sales by month, last 12 months" />
        </section>
      </div>

      <section className="col" style={{ gap: 10 }} aria-label="Customers">
        <div className="row between" style={{ gap: 10 }}>
          <b style={{ fontSize: 18 }}>{who === profile.id ? "My customers" : "Customers"}</b>
          <span className="small faint">{rows.length}</span>
        </div>
        <CustomerTable rows={rows} showRep={!who} reps={reps} canAssign={all} />
      </section>
    </main>
  );
}
