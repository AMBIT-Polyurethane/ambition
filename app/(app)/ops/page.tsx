import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, CalendarRange, ChevronRight, UserRound, CircleAlert, CircleCheck, ClipboardCheck, FileSignature, Flame, FlaskConical, Gauge, Layers, LifeBuoy, Package, Plus, Ruler, Target, TrendingDown, Users,
} from "lucide-react";
import { HBar, ProfitBars, Spark, YieldRing } from "@/components/ops/charts";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { loadWorkspace, type Workspace } from "@/lib/ops/server";
import { money0 } from "@/lib/ops/crm";
import { opsCan, opsMember } from "@/lib/ops/roles";
import { CLOSED, stageName } from "@/lib/ops/defaults";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateShort, firstName, greeting } from "@/lib/format";
import { lineText, rangeText, timeText } from "@/lib/ops/schedule";
import { setupSteps } from "@/lib/ops/setup";
import type { Kpis } from "@/lib/ops/kpis";
import { dailyBrief } from "@/lib/ops/brief";
import { Guide, GuideButton } from "@/components/ops/ai/guide";
import { enterWorkspace } from "./workspace-actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

export const metadata = { title: "AMBIT-OPS" };
export const dynamic = "force-dynamic";

export default async function OpsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const ws = await loadWorkspace(supabase, profile);
  const alerts = (
    <>
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
    </>
  );
  if (ws) return <WorkspaceHome supabase={supabase} profile={profile} ws={ws} alerts={alerts} />;
  if (!isEmployee(profile)) redirect(opsMember(profile) ? "/profile" : "/");
  if (!can(profile, "takeoff")) redirect("/");
  return <StaffHome supabase={supabase} profile={profile} alerts={alerts} />;
}

// ------------------------------------------------------------------ a contractor's workspace
async function WorkspaceHome({ supabase, profile, ws, alerts }: { supabase: SupabaseClient; profile: Profile; ws: Workspace; alerts: React.ReactNode }) {
  const role = ws.role;
  const hi = `${greeting()}, ${firstName(profile.full_name, profile.email)}`;

  if (opsCan.fieldOnly(role)) {
    const head = (
      <header className="ops-head">
        {ws.logoUrl ? <img src={ws.logoUrl} alt="" className="ops-logo" /> : <span className="ops-logo ph">{ws.brand.slice(0, 1)}</span>}
        <span className="col tight" style={{ minWidth: 0 }}>
          <span className="eyebrow">{ws.brand}</span>
          <h1 className="h1" style={{ margin: 0 }}>{hi}</h1>
        </span>
      </header>
    );
    const { data: mine } = await supabase.rpc("ops_my_trips", { p_days: 7 });
    return (
      <main className="shell wide">
        {alerts}
        {head}
        <Link href="/ops/field" className="card ops-field-cta">
          <ClipboardCheck size={22} />
          <span className="col tight grow">
            <b>Work orders</b>
            <span className="small muted">Clock in, log sets and lots, the spray log, photos and the customer&apos;s signature. Works with no signal.</span>
          </span>
          <ChevronRight size={18} className="faint" />
        </Link>
        <CrewWeek trips={(mine ?? []) as CrewTrip[]} />
        <div className="list">
          <Link href="/docs" className="item"><div className="grow"><div className="t">Product docs</div><div className="s">TDS, SDS and install guides</div></div><ChevronRight size={18} className="chev" /></Link>
          <Link href="/academy" className="item"><div className="grow"><div className="t">AMBIT Academy</div><div className="s">Training and certifications</div></div><ChevronRight size={18} className="chev" /></Link>
        </div>
      </main>
    );
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const co = ws.company.id;
  const [{ data: kpiRaw }, { data: leadRows }, { data: tasks }, steps] = await Promise.all([
    supabase.rpc("ops_kpis"),
    supabase.from("ops_leads").select("id, number, title, stage, created_at, customer:ops_customers(name)").eq("company_id", co).not("stage", "in", "(won,lost)").order("created_at", { ascending: false }).limit(6),
    supabase
      .from("ops_notes")
      .select("id, body, due_on, lead_id, customer_id, lead:ops_leads(number, title)")
      .eq("company_id", co)
      .eq("kind", "task")
      .is("done_at", null)
      .or(`assigned_to.eq.${profile.id},and(assigned_to.is.null,created_by.eq.${profile.id})`)
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(7),
    setupSteps(supabase, ws),
  ]);
  const k = (kpiRaw ?? null) as Kpis | null;
  type L = { id: string; number: number; title: string | null; stage: string; created_at: string; customer: { name: string } | null };
  const leads = (leadRows ?? []) as unknown as L[];
  type Tk = { id: string; body: string; due_on: string | null; lead_id: string | null; customer_id: string | null; lead: { number: number; title: string | null } | null };
  const taskList = (tasks ?? []) as unknown as Tk[];

  // Guided setup (owner and office): what's left before the first quote (lib/ops/setup.ts).
  const s = ws.settings;
  const left = steps.filter((x) => !x.done).length;

  // ---- the numbers
  const months = k?.months ?? [];
  const cur = months[months.length - 1] ?? { m: today.slice(0, 7), revenue: 0, cost: 0, jobs: 0, sold: 0 };
  const prev = months[months.length - 2] ?? null;
  const gp = cur.revenue - cur.cost;
  const gpPct = cur.revenue ? (gp / cur.revenue) * 100 : null;
  const yr = months.reduce((a, m) => ({ rev: a.rev + m.revenue, cost: a.cost + m.cost, jobs: a.jobs + m.jobs }), { rev: 0, cost: 0, jobs: 0 });
  const soldDelta = k && k.sold.prev > 0 ? ((k.sold.month - k.sold.prev) / k.sold.prev) * 100 : null;
  const gpPrevPct = prev && prev.revenue ? ((prev.revenue - prev.cost) / prev.revenue) * 100 : null;
  const weeks = k && k.backlog.weekly > 0 ? k.backlog.value / k.backlog.weekly : null;
  const decided = (k?.pipeline.won90 ?? 0) + (k?.pipeline.lost90 ?? 0);
  const winRate = decided ? ((k?.pipeline.won90 ?? 0) / decided) * 100 : null;
  const todayTrips = k?.today_trips ?? [];
  const crewsOut = new Set(todayTrips.map((t) => t.rig ?? t.id)).size;
  const review = k?.work_orders.review ?? 0;
  const due = k?.pipeline.due ?? 0;
  const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  const stageOrder = ws.settings.stages.filter((x) => !CLOSED.includes(x.key));
  const stageRows = stageOrder.map((st) => {
    const r = k?.pipeline.stages.find((x) => x.key === st.key);
    return { key: st.key, name: st.name, count: r?.count ?? 0, value: Number(r?.value ?? 0) };
  });
  const stageMax = Math.max(1, ...stageRows.map((r) => r.value));
  const kinds = (k?.yield.kinds ?? []).filter((y) => y.target);
  const chem = k?.chem;
  const chemRows = chem
    ? [
        { key: "oc", name: "Open cell resin", sub: "AMBI-SEAL drums", have: chem.oc, need: chem.oc_need },
        { key: "cc", name: "Closed cell resin", sub: "AMBI-TITE drums", have: chem.cc, need: chem.cc_need },
        { key: "iso", name: "ISO (A side)", sub: "Drums, all brands", have: chem.iso, need: chem.oc_need + chem.cc_need },
      ].filter((r) => r.have > 0 || r.need > 0)
    : [];
  const chemShort = chemRows.some((r) => r.have < r.need);
  const custMax = Math.max(1, ...(k?.customers ?? []).map((c) => Number(c.revenue)));
  const dayName = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const brief = dailyBrief({ k, tasks: taskList, first: firstName(profile.full_name, profile.email), today, hello: greeting() });

  const summary = [
    crewsOut ? `${crewsOut} crew${crewsOut === 1 ? " is" : "s are"} out on ${todayTrips.length} job${todayTrips.length === 1 ? "" : "s"} today.` : "No crews are scheduled today.",
    review ? `${review} finished work order${review === 1 ? "" : "s"} need${review === 1 ? "s" : ""} your review` : null,
    due ? `${due} follow-up${due === 1 ? " is" : "s are"} due` : null,
  ].filter(Boolean);
  const summaryText = summary.length > 1 ? `${summary[0]} ${summary.slice(1).join(", and ")}.` : summary[0];

  return (
    <main className="shell wide ops-home">
      {alerts}

      <section className="oh-hero">
        <div className="oh-hero-main">
          {ws.logoUrl ? <img src={ws.logoUrl} alt="" className="oh-logo" /> : <span className="oh-logo ph">{ws.brand.slice(0, 1)}</span>}
          <span className="col tight" style={{ minWidth: 0 }}>
            <span className="oh-eyebrow"><span className="oh-eb-brand">{ws.brand} · </span>{dayName}</span>
            <h1 className="oh-hi">{hi}</h1>
            <span className="oh-sum">{summaryText}</span>
          </span>
        </div>
        <div className="oh-actions">
          <Link href="/ops/leads/new" className="btn sm"><Plus size={15} /> New lead</Link>
          <Link href="/ops/quotes/new" className="btn sm dark"><FileSignature size={15} /> New quote</Link>
          <Link href="/ops/schedule" className="btn sm dark"><CalendarRange size={15} /> Schedule</Link>
        </div>
        <GuideButton mode="brief" className="oh-ambit">
          <img src="/brand/atom-mark.png" alt="" /> <span>Today&apos;s briefing</span>
        </GuideButton>
        <Link href="/profile" className="oh-me" aria-label="Your profile"><UserRound size={18} /></Link>
      </section>

      <Guide userId={profile.id} first={firstName(profile.full_name, profile.email)} brand={ws.brand} today={today} steps={steps} brief={brief} />

      {steps.length && left ? (
        <section className="card oh-setup">
          <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
            <span className="col tight">
              <b>Finish setting up ({steps.length - left} of {steps.length})</b>
              <span className="tiny faint">About 15 minutes. AMBIT products and your AMBIT prices are already in.</span>
            </span>
            <GuideButton mode="setup" className="btn sm dark oh-walk">
              <img src="/brand/atom-mark.png" alt="" /> Walk me through it
            </GuideButton>
            <div className="gbar" aria-hidden="true" style={{ flex: "1 1 200px", maxWidth: 360 }}><div className="fill" style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
          </div>
          <div className="oh-setup-list">
            {steps.filter((x) => !x.done).map((x) => (
              <Link key={x.label} href={x.href} className="oh-setup-row">
                <span className="ops-tick" />
                <span className="grow col tight" style={{ minWidth: 0 }}>
                  <span className="t">{x.label}</span>
                  <span className="tiny faint">{x.hint}</span>
                </span>
                <ChevronRight size={16} className="faint" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {k ? (
        <>
          <section className="oh-kpis" aria-label="Key numbers">
            <Link href="/ops/quotes" className="oh-kpi">
              <span className="oh-k-l"><FileSignature size={15} /> Sold this month</span>
              <b className="oh-k-v">{money0(k.sold.month)}</b>
              <span className="oh-k-s">
                {soldDelta !== null ? <Delta pct={soldDelta} /> : null}
                <span>{k.sold.jobs} job{k.sold.jobs === 1 ? "" : "s"} signed{soldDelta !== null ? " · vs same days last month" : ""}</span>
              </span>
              <Spark values={months.map((m) => m.sold)} labels={months.map((m) => monthLabel(m.m))} />
            </Link>
            <Link href="/ops/work-orders" className="oh-kpi">
              <span className="oh-k-l"><Gauge size={15} /> Gross profit, finished this month</span>
              <b className="oh-k-v">{money0(gp)}</b>
              <span className="oh-k-s">
                {gpPct !== null ? <span className={`oh-chip ${gpPct >= (s.target_margin ?? 40) ? "ok" : gpPct >= (s.floor_margin ?? 25) ? "warn" : "bad"}`}>{gpPct.toFixed(0)}% margin</span> : null}
                <span>{money0(cur.revenue)} on {cur.jobs} job{cur.jobs === 1 ? "" : "s"}{gpPrevPct !== null ? ` · last month ${gpPrevPct.toFixed(0)}%` : ""}</span>
              </span>
              <Spark values={months.map((m) => m.revenue - m.cost)} labels={months.map((m) => monthLabel(m.m))} />
            </Link>
            <Link href="/ops/schedule" className="oh-kpi">
              <span className="oh-k-l"><Layers size={15} /> Backlog (sold, not done)</span>
              <b className="oh-k-v">{money0(k.backlog.value)}</b>
              <span className="oh-k-s">
                {weeks !== null ? <span className="oh-chip info">{weeks < 1 ? "Under a week" : `~${weeks.toFixed(1)} weeks`} of work</span> : null}
                <span>{k.backlog.jobs} jobs{k.backlog.unscheduled ? ` · ${k.backlog.unscheduled} not scheduled` : ""}</span>
              </span>
              <div className="oh-split" aria-hidden="true">
                <i style={{ flex: Math.max(0, k.backlog.jobs - k.backlog.unscheduled) }} />
                <i className="u" style={{ flex: k.backlog.unscheduled }} />
              </div>
            </Link>
            <Link href="/ops/pipeline" className="oh-kpi">
              <span className="oh-k-l"><Target size={15} /> Win rate, last 90 days</span>
              <b className="oh-k-v">{winRate !== null ? `${Math.round(winRate)}%` : "–"}</b>
              <span className="oh-k-s">
                <span className="oh-chip info">{money0(k.pipeline.quotes_out)} out</span>
                <span>{k.pipeline.quotes_out_n} quote{k.pipeline.quotes_out_n === 1 ? "" : "s"} waiting · {k.pipeline.won90} won, {k.pipeline.lost90} lost</span>
              </span>
              <div className="oh-split" aria-hidden="true">
                <i style={{ flex: k.pipeline.won90 }} />
                <i className="l" style={{ flex: k.pipeline.lost90 }} />
              </div>
            </Link>
          </section>

          <div className="oh-grid">
            <section className="card oh-card oh-profit">
              <div className="oh-card-h">
                <span className="col tight">
                  <b>Revenue and gross profit</b>
                  <span className="tiny faint">Finished jobs, last 12 months · {money0(yr.rev)} revenue · {yr.rev ? Math.round(((yr.rev - yr.cost) / yr.rev) * 100) : 0}% margin</span>
                </span>
                <span className="oh-legend"><span><i className="sw p" />Gross profit</span><span><i className="sw c" />Job cost</span></span>
              </div>
              <ProfitBars data={months.map((m) => ({ m: m.m, revenue: Number(m.revenue), cost: Number(m.cost), jobs: m.jobs }))} />
            </section>

            <section className="card oh-card oh-yield">
              <div className="oh-card-h">
                <span className="col tight">
                  <b>Yield</b>
                  <span className="tiny faint">Board feet per set against your target, last 90 days</span>
                </span>
              </div>
              {kinds.length ? (
                <div className="oh-rings">
                  {kinds.map((y) => (
                    <YieldRing key={y.kind} pct={(Number(y.actual) / Number(y.target)) * 100}
                      label={y.kind === "foam_oc" ? "Open cell" : y.kind === "foam_cc" ? "Closed cell" : "Roofing foam"}
                      sub={`${Number(y.actual).toLocaleString()} of ${Number(y.target).toLocaleString()} bd ft/set`} />
                  ))}
                </div>
              ) : (
                <span className="small muted">Yield shows up once crews finish work orders with sets and areas.</span>
              )}
              {Number(k.yield.waste_dollars) > 0 ? (
                <Link href="/ops/work-orders" className="oh-waste">
                  <CircleAlert size={16} />
                  <span><b>{money0(Number(k.yield.waste_dollars))}</b> in chemical beyond what was sold ({Number(k.yield.waste_sets).toLocaleString()} sets): low yield and overspray.</span>
                </Link>
              ) : null}
              {k.yield.rigs.length ? (
                <div className="oh-rows">
                  {k.yield.rigs.map((r) => {
                    const pct = (Number(r.actual) / Number(r.target)) * 100;
                    return (
                      <div key={`${r.rig}-${r.kind}`} className="oh-row">
                        <i className="dot" style={{ background: r.color ?? "var(--c2)" }} />
                        <span className="grow ellipsis small">{r.rig} <span className="faint">· {r.kind === "foam_oc" ? "OC" : "CC"}</span></span>
                        <span className={`oh-chip ${pct >= 98 ? "ok" : pct >= 90 ? "warn" : "bad"}`}>{Math.round(pct)}%</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className="card oh-card oh-today">
              <div className="oh-card-h">
                <span className="col tight"><b>Today</b><span className="tiny faint">{dayName}</span></span>
                <Link href="/ops/schedule" className="linkbtn small">Schedule <ArrowRight size={14} /></Link>
              </div>
              {todayTrips.length ? (
                <div className="oh-trips">
                  {todayTrips.slice(0, 5).map((t) => (
                    <Link key={t.id} href={`/ops/jobs/${t.job_id}`} className="oh-trip" style={{ ["--rig" as string]: t.color ?? "var(--c1)" }}>
                      <span className="grow col tight" style={{ minWidth: 0 }}>
                        <span className="tiny faint ellipsis">{t.rig ?? "No rig"}{t.days > 1 ? ` · day ${t.day} of ${t.days}` : ""}</span>
                        <b className="ellipsis">{t.customer}</b>
                        <span className="tiny faint ellipsis">#{t.job_no} · {t.title ?? "Job"}{t.city ? ` · ${t.city}` : ""}</span>
                      </span>
                      <span className={`oh-chip ${t.wo_open ? "ok" : "info"}`}>{t.wo_open ? "On site" : "Scheduled"}</span>
                    </Link>
                  ))}
                  {todayTrips.length > 5 ? <Link href="/ops/schedule" className="linkbtn small">+ {todayTrips.length - 5} more today</Link> : null}
                </div>
              ) : (
                <span className="small muted">No crews scheduled today.</span>
              )}
              <div className="oh-days" aria-label="Trips over the next two weeks">
                {(k.week ?? []).map((d, i) => {
                  const date = new Date(`${String(d.d).slice(0, 10)}T12:00:00`);
                  const max = Math.max(1, k.rigs || 1, ...(k.week ?? []).map((x) => x.n));
                  return (
                    <span key={i} className={`oh-day${i === 0 ? " now" : ""}${[0, 6].includes(date.getDay()) ? " wk" : ""}`} title={`${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}: ${d.n} trip${d.n === 1 ? "" : "s"}`}>
                      <i style={{ height: `${Math.min(100, (d.n / max) * 100)}%` }} />
                      <span>{date.toLocaleDateString("en-US", { weekday: "narrow" })}</span>
                    </span>
                  );
                })}
              </div>
            </section>

            <section className="card oh-card oh-pipe">
              <div className="oh-card-h">
                <span className="col tight"><b>Pipeline</b><span className="tiny faint">Open leads by step · {k.pipeline.new7} new this week</span></span>
                <Link href="/ops/pipeline" className="linkbtn small">Leads <ArrowRight size={14} /></Link>
              </div>
              <div className="oh-rows">
                {stageRows.map((r, i) => (
                  <Link key={r.key} href="/ops/pipeline" className="oh-row stage">
                    <span className="oh-stage-n">{r.count}</span>
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <span className="row between small"><span className="ellipsis">{r.name}</span><b>{money0(r.value)}</b></span>
                      <HBar value={r.value} max={stageMax} color={i >= stageRows.length - 2 ? "var(--c1)" : "var(--c2)"} />
                    </span>
                  </Link>
                ))}
              </div>
              <div className="oh-foot">
                <span className={due ? "oh-chip warn" : "oh-chip ok"}>{due ? `${due} follow-up${due === 1 ? "" : "s"} due` : "No follow-ups due"}</span>
                <span className="tiny faint">{k.pipeline.quotes_out_n} quotes out · {money0(k.pipeline.quotes_out)}</span>
              </div>
            </section>

            <section className="card oh-card oh-chem">
              <div className="oh-card-h">
                <span className="col tight"><b>Chemical check</b><span className="tiny faint">On the shelf and rigs vs. the next 14 days</span></span>
                <span className={`oh-chip ${chemShort ? "bad" : "ok"}`}>{chemShort ? "Short" : "Covered"}</span>
              </div>
              {chemRows.length ? (
                <div className="oh-rows">
                  {chemRows.map((r) => {
                    const pct = r.need > 0 ? (r.have / r.need) * 100 : 100;
                    const tone = r.have >= r.need ? "ok" : pct >= 70 ? "warn" : "bad";
                    return (
                      <div key={r.key} className="oh-chem-row">
                        <span className="row between small">
                          <span>{r.name} <span className="faint">· {r.sub}</span></span>
                          <b>{fmtNum(r.have)} <span className="faint">/ {fmtNum(r.need)} needed</span></b>
                        </span>
                        <span className={`oh-meter ${tone}`}><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="small muted">Count your chemical in Stock and it&apos;s checked against the schedule here.</span>
              )}
              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
                <Link href="/order" className="btn sm ambit"><Package size={15} /> Order from AMBIT</Link>
                <Link href="/ops/stock" className="btn sm dark">Stock</Link>
              </div>
            </section>

            <section className="card oh-card oh-attn">
              <div className="oh-card-h"><span className="col tight"><b>Needs a look</b><span className="tiny faint">What&apos;s waiting on you</span></span></div>
              <div className="oh-rows">
                <Link href="/ops/work-orders" className="oh-row link">
                  <span className="oh-ic"><ClipboardCheck size={16} /></span>
                  <span className="grow small">Work orders to review</span>
                  <span className={`oh-chip ${review ? "warn" : "ok"}`}>{review}</span>
                </Link>
                {k.attention.low_yield.slice(0, 3).map((x) => (
                  <Link key={`${x.job_id}-${x.kind}`} href={`/ops/jobs/${x.job_id}`} className="oh-row link">
                    <span className="oh-ic bad"><TrendingDown size={16} /></span>
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <span className="small ellipsis">Low yield · #{x.job_no} {x.customer}</span>
                      <span className="tiny faint">{x.kind === "foam_oc" ? "Open cell" : "Closed cell"} at {x.pct}% of target</span>
                    </span>
                  </Link>
                ))}
                {k.attention.hot_quotes.slice(0, 3).map((q) => (
                  <Link key={q.id} href={`/ops/quotes/${q.id}`} className="oh-row link">
                    <span className="oh-ic hot"><Flame size={16} /></span>
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <span className="small ellipsis">Quote #{q.number} · {q.customer}</span>
                      <span className="tiny faint">Opened {q.views}× · {money0(Number(q.total))} · not signed yet</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <section className="card oh-card oh-cust">
              <div className="oh-card-h">
                <span className="col tight"><b>Top customers</b><span className="tiny faint">Sold, last 12 months</span></span>
                <Link href="/ops/customers" className="linkbtn small">All <ArrowRight size={14} /></Link>
              </div>
              <div className="oh-rows">
                {(k.customers ?? []).map((c) => (
                  <Link key={c.id} href={`/ops/customers/${c.id}`} className="oh-row stage">
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <span className="row between small"><span className="ellipsis">{c.name} <span className="faint">· {c.jobs} job{c.jobs === 1 ? "" : "s"}</span></span><b>{money0(Number(c.revenue))}</b></span>
                      <HBar value={Number(c.revenue)} max={custMax} color="var(--c2)" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}

      <div className="ops-two">
        <section className="card col" style={{ gap: 10 }} id="tasks">
          <div className="row between">
            <b>Your tasks</b>
            <Link href="/ops/leads/new" className="btn sm"><Plus size={15} /> New lead</Link>
          </div>
          {taskList.length ? (
            <div className="ops-tasks">
              {taskList.map((t) => (
                <Link key={t.id} href={t.lead_id ? `/ops/leads/${t.lead_id}` : t.customer_id ? `/ops/customers/${t.customer_id}` : "/ops"} className="ops-task">
                  <span className={`ops-due${t.due_on && t.due_on < today ? " late" : t.due_on === today ? " today" : ""}`}>{t.due_on ? (t.due_on === today ? "Today" : dateShort(t.due_on).replace(/, \d{4}$/, "")) : "Any time"}</span>
                  <span className="grow col tight" style={{ minWidth: 0 }}>
                    <span className="ellipsis">{t.body}</span>
                    {t.lead ? <span className="tiny faint ellipsis">Lead #{t.lead.number}{t.lead.title ? ` · ${t.lead.title}` : ""}</span> : null}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <span className="small muted">No open tasks. Add one from any lead.</span>
          )}
        </section>
        <section className="card col" style={{ gap: 10 }}>
          <div className="row between">
            <b>Latest leads</b>
            <Link href="/ops/pipeline" className="linkbtn small">Pipeline <ArrowRight size={14} /></Link>
          </div>
          {leads.length ? (
            <div className="ops-tasks">
              {leads.map((l) => (
                <Link key={l.id} href={`/ops/leads/${l.id}`} className="ops-task">
                  <span className="pill grey">{stageName(ws.settings, l.stage)}</span>
                  <span className="grow col tight" style={{ minWidth: 0 }}>
                    <span className="ellipsis">{l.customer?.name ?? "Customer"}</span>
                    <span className="tiny faint ellipsis">#{l.number}{l.title ? ` · ${l.title}` : ""} · {dateShort(l.created_at)}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <span className="small muted">No leads yet. Add one, or share your lead form so requests come in on their own.</span>
          )}
        </section>
      </div>
    </main>
  );
}

const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));

function Delta({ pct }: { pct: number }) {
  const up = pct >= 0;
  return <span className={`oh-chip ${up ? "ok" : "bad"}`}>{up ? "▲" : "▼"} {Math.abs(pct) >= 999 ? "999+" : Math.abs(pct).toFixed(0)}%</span>;
}





// ------------------------------------------------------------------ AMBIT staff (no workspace open)
const PLANNED = [
  { icon: FileSignature, title: "Quoting & proposals", text: "Turn a takeoff into an estimate and a branded proposal, then into an AMBIT order." },
  { icon: Users, title: "CRM", text: "Customers, leads, contacts and every job in one place." },
  { icon: CalendarRange, title: "Scheduling & dispatch", text: "Rigs and crews by day; the customer is told when you're on the way." },
  { icon: Gauge, title: "Job costing & yield", text: "Sets used, board feet sprayed and real profit on every job." },
];

async function StaffHome({ supabase, profile, alerts }: { supabase: SupabaseClient; profile: Profile; alerts: React.ReactNode }) {
  const admin = profile.role === "admin";
  const [{ count }, { data: open }] = await Promise.all([
    supabase.from("takeoffs").select("id", { count: "exact", head: true }),
    admin
      ? supabase.from("companies").select("id, name, ops_demo, ops_support_until").eq("ops_enabled", true).order("name")
      : Promise.resolve({ data: [] }),
  ]);
  const now = Date.now();
  const canOpen = ((open ?? []) as { id: string; name: string; ops_demo: boolean; ops_support_until: string | null }[]).filter(
    (c) => c.ops_demo || (!!c.ops_support_until && Date.parse(c.ops_support_until) > now),
  );
  return (
    <main className="shell wide">
      <TopBar title="AMBIT-OPS" back="/" />
      {alerts}
      <section className="ops-hero">
        <span className="eyebrow">Contractor operations software</span>
        <h2>Everything a spray foam and insulation contractor runs on, inside AMBIT Intelligence.</h2>
        <p>Takeoff is live for AMBIT. Contractors get their own workspace: leads, customers, quotes, scheduling and crew work orders now; invoices and job costing by Dec 1.</p>
      </section>

      {admin ? (
        <section className="card col" style={{ gap: 10 }}>
          <div className="row between" style={{ gap: 8 }}>
            <b>Contractor workspaces</b>
            <Link href="/admin/ops" className="linkbtn small">Manage</Link>
          </div>
          {canOpen.length ? (
            <div className="list">
              {canOpen.map((c) => (
                <form key={c.id} action={enterWorkspace} className="item">
                  <input type="hidden" name="company_id" value={c.id} />
                  <div className="ic">{c.ops_demo ? <FlaskConical size={18} /> : <LifeBuoy size={18} />}</div>
                  <div className="grow">
                    <div className="t ellipsis">{c.name}</div>
                    <div className="s">{c.ops_demo ? "AMBIT demo" : `The owner allowed AMBIT to help until ${dateShort(c.ops_support_until)}`}</div>
                  </div>
                  <Submit className="btn sm" pendingText="Opening…">Open</Submit>
                </form>
              ))}
            </div>
          ) : (
            <span className="small muted">None to open right now. Create a demo workspace, or ask a contractor&apos;s owner to turn on &ldquo;Let AMBIT help&rdquo;.</span>
          )}
        </section>
      ) : null}

      <div className="ops-grid">
        <Link href="/takeoff" className="ops-card live">
          <span className="ops-ic"><Ruler size={22} /></span>
          <span className="col tight grow" style={{ minWidth: 0 }}>
            <span className="row" style={{ gap: 8, alignItems: "center" }}>
              <b>Takeoff</b>
              <span className="pill ok">Live</span>
            </span>
            <span className="s">Upload plans, measure areas, walls and counts, and get board feet and materials.</span>
            <span className="tiny faint">{count ?? 0} takeoff{count === 1 ? "" : "s"}</span>
          </span>
          <ChevronRight size={18} className="chev" />
        </Link>
        {PLANNED.map((m) => (
          <div key={m.title} className="ops-card soon" aria-disabled="true">
            <span className="ops-ic"><m.icon size={22} /></span>
            <span className="col tight grow" style={{ minWidth: 0 }}>
              <span className="row" style={{ gap: 8, alignItems: "center" }}>
                <b>{m.title}</b>
                <span className="pill grey">Contractors</span>
              </span>
              <span className="s">{m.text}</span>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ a crew member's next 7 days
type CrewTrip = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  days: number;
  start_time: string | null;
  status: string;
  notes: string | null;
  job_number: number;
  crew_notes: string | null;
  customer: string;
  phone: string | null;
  address: string | null;
  gate_code: string | null;
  property_notes: string | null;
  rig: string | null;
  crew: { name: string; lead: boolean }[] | null;
  work: { area: string | null; name: string; detail: string | null; sqft: number | null; depth_in: number | null; r_value: number | null; units: number | null; unit: string | null; kind: string }[] | null;
};

function CrewWeek({ trips }: { trips: CrewTrip[] }) {
  return (
    <section className="col" style={{ gap: 10 }}>
      <div className="row between"><b style={{ fontSize: 17 }}>Your next 7 days</b><span className="tiny faint">{trips.length} trip{trips.length === 1 ? "" : "s"}</span></div>
      {trips.length ? (
        trips.map((t) => (
          <article key={t.id} className="card col crew-trip" style={{ gap: 8 }}>
            <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
              <span className="col tight" style={{ minWidth: 0 }}>
                <b>{rangeText(t.start_date, t.days)}{t.start_time ? ` · ${timeText(t.start_time)}` : ""}</b>
                <span className="small">{t.customer} · job #{t.job_number}</span>
              </span>
              {t.rig ? <span className="pill info">{t.rig}</span> : null}
            </div>
            {t.address ? (
              <a className="small" href={`https://maps.google.com/?q=${encodeURIComponent(t.address)}`} target="_blank" rel="noopener">{t.address}</a>
            ) : null}
            {t.gate_code ? <span className="small">Gate code <b>{t.gate_code}</b></span> : null}
            <ul className="job-lines compact">
              {(t.work ?? []).map((w, i) => (
                <li key={i}>
                  {w.area ? <span className="q-code">{w.area}</span> : null}
                  <span className="grow col tight" style={{ minWidth: 0 }}>
                    <span className="small ellipsis">{w.name}</span>
                    <span className="tiny faint ellipsis">{lineText(w)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {t.crew?.length ? <span className="tiny faint">Crew: {t.crew.map((c) => `${c.name}${c.lead ? " (lead)" : ""}`).join(", ")}</span> : null}
            {[t.crew_notes, t.property_notes, t.notes].filter(Boolean).length ? <span className="small muted">{[t.crew_notes, t.property_notes, t.notes].filter(Boolean).join(" · ")}</span> : null}
            {t.phone ? <a className="btn sm dark" href={`tel:${t.phone}`} style={{ alignSelf: "flex-start" }}>Call the customer</a> : null}
          </article>
        ))
      ) : (
        <div className="card small muted">Nothing on your schedule for the next 7 days. When the office puts you on a trip, it shows up here.</div>
      )}
    </section>
  );
}
