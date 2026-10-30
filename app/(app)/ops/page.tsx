import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, CalendarRange, Check, ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, FileSignature, FlaskConical, Gauge, LifeBuoy, Plus, Receipt, Ruler, SquareKanban, Users,
} from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { loadWorkspace, type Workspace } from "@/lib/ops/server";
import { money0 } from "@/lib/ops/crm";
import { opsCan, opsMember } from "@/lib/ops/roles";
import { CLOSED, stageName } from "@/lib/ops/defaults";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateShort, firstName, greeting } from "@/lib/format";
import { addDays, lineText, rangeText, timeText } from "@/lib/ops/schedule";
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
  const head = (
    <header className="ops-head">
      {ws.logoUrl ? <img src={ws.logoUrl} alt="" className="ops-logo" /> : <span className="ops-logo ph">{ws.brand.slice(0, 1)}</span>}
      <span className="col tight" style={{ minWidth: 0 }}>
        <span className="eyebrow">{ws.brand}</span>
        <h1 className="h1" style={{ margin: 0 }}>{hi}</h1>
      </span>
    </header>
  );

  if (opsCan.fieldOnly(role)) {
    const { data: mine } = await supabase.rpc("ops_my_trips", { p_days: 7 });
    return (
      <main className="shell wide">
        {alerts}
        {head}
        <CrewWeek trips={(mine ?? []) as CrewTrip[]} />
        <div className="card col" style={{ gap: 8 }}>
          <b><ClipboardCheck size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Work orders are coming</b>
          <span className="small muted">Starting Nov 26 you&apos;ll also clock in and out, log the sets you spray with their lots, and take the job photos right here.</span>
        </div>
        <div className="list">
          <Link href="/docs" className="item"><div className="grow"><div className="t">Product docs</div><div className="s">TDS, SDS and install guides</div></div><ChevronRight size={18} className="chev" /></Link>
          <Link href="/academy" className="item"><div className="grow"><div className="t">AMBIT Academy</div><div className="s">Training and certifications</div></div><ChevronRight size={18} className="chev" /></Link>
        </div>
      </main>
    );
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const co = ws.company.id;
  const [{ data: leadRows }, { data: tasks }, { count: customers }, { count: team }, { count: products }, { count: invites }, { data: quoteRows }] = await Promise.all([
    supabase.from("ops_leads").select("id, number, title, stage, next_at, created_at, stage_changed_at, customer:ops_customers(name)").eq("company_id", co).order("created_at", { ascending: false }).limit(400),
    supabase
      .from("ops_notes")
      .select("id, body, due_on, lead_id, customer_id, lead:ops_leads(number, title)")
      .eq("company_id", co)
      .eq("kind", "task")
      .is("done_at", null)
      .or(`assigned_to.eq.${profile.id},and(assigned_to.is.null,created_by.eq.${profile.id})`)
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase.from("ops_customers").select("id", { count: "exact", head: true }).eq("company_id", co),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", co).not("ops_role", "is", null),
    supabase.from("ops_products").select("id", { count: "exact", head: true }).eq("company_id", co).eq("active", true),
    opsCan.manage(role) ? supabase.from("invites").select("id", { count: "exact", head: true }).eq("company_id", co).is("accepted_at", null).is("cancelled_at", null) : Promise.resolve({ count: 0 }),
    supabase.from("ops_quotes").select("status, totals, signed_total, signed_at").eq("company_id", co).in("status", ["draft", "sent", "viewed", "signed"]).order("updated_at", { ascending: false }).limit(500),
  ]);
  const weekEnd = addDays(today, 6);
  const [{ count: toSchedule }, { count: thisWeek }] = opsCan.jobs(role)
    ? await Promise.all([
        supabase.from("ops_trips").select("id, job:ops_jobs!inner(status)", { count: "exact", head: true }).eq("company_id", co).eq("status", "unscheduled").eq("job.status", "open"),
        supabase.from("ops_trips").select("id", { count: "exact", head: true }).eq("company_id", co).in("status", ["scheduled", "in_progress"]).lte("start_date", weekEnd).gte("end_date", today),
      ])
    : [{ count: 0 }, { count: 0 }];
  type Qr = { status: string; totals: { options?: Record<string, { total: number }> }; signed_total: number | null; signed_at: string | null };
  const qs = (quoteRows ?? []) as Qr[];
  const qTop = (q: Qr) => Math.max(0, ...Object.values(q.totals?.options ?? {}).map((o) => Number(o.total) || 0));
  const outQ = qs.filter((q) => q.status === "sent" || q.status === "viewed");
  const draftQ = qs.filter((q) => q.status === "draft").length;
  const signedMonth = qs.filter((q) => q.status === "signed" && q.signed_at && q.signed_at.slice(0, 10) >= today.slice(0, 8) + "01");
  type L = { id: string; number: number; title: string | null; stage: string; next_at: string | null; created_at: string; stage_changed_at: string; customer: { name: string } | null };
  const leads = (leadRows ?? []) as unknown as L[];
  const open = leads.filter((l) => !CLOSED.includes(l.stage));
  const fresh = open.filter((l) => l.stage === "new").length;
  const due = open.filter((l) => l.next_at && l.next_at <= today).length;
  const monthStart = today.slice(0, 8) + "01";
  const wonMonth = leads.filter((l) => l.stage === "won" && l.stage_changed_at.slice(0, 10) >= monthStart).length;
  type Tk = { id: string; body: string; due_on: string | null; lead_id: string | null; customer_id: string | null; lead: { number: number; title: string | null } | null };

  // Guided setup (owner and office): what's left before the first quote.
  const s = ws.settings as typeof ws.settings & { reviewed?: Record<string, boolean> };
  const raw = (ws.company.ops_settings ?? {}) as Record<string, unknown>;
  const reviewed = (raw.reviewed ?? {}) as Record<string, boolean>;
  const steps = opsCan.manage(role)
    ? [
        { done: !!ws.company.ops_logo_path && !!s.phone, label: "Add your logo and contact info", hint: "They go on proposals, invoices and your lead form", href: "/ops/settings/company" },
        { done: !!reviewed.products && (products ?? 0) > 0, label: "Check your products and AMBIT costs", hint: "Foam sets and fiberglass are already loaded from your AMBIT invoices", href: "/ops/settings/products" },
        { done: !!reviewed.labor && s.target_margin !== null && s.floor_margin !== null, label: "Set labor rates and margins", hint: "Defaults are in; add your target and lowest margin", href: "/ops/settings/pricing" },
        { done: (team ?? 0) + (invites ?? 0) > 1, label: "Invite your team", hint: "Office, sales and crews each get their own login", href: "/ops/settings/team" },
        { done: (customers ?? 0) > 0, label: "Bring in your customers", hint: "Upload a spreadsheet or add them as you go", href: "/ops/customers/import" },
        { done: !!reviewed.form, label: "Put the lead form on your website", hint: "Requests land right in your pipeline", href: "/ops/settings/lead-form" },
      ]
    : [];
  const left = steps.filter((x) => !x.done).length;

  const path = [
    { icon: SquareKanban, title: "Leads", value: `${open.length}`, sub: fresh ? `${fresh} new · ${due} to follow up` : due ? `${due} to follow up today` : "open in your pipeline", href: "/ops/pipeline", live: true },
    {
      icon: FileSignature,
      title: "Quotes",
      value: outQ.length ? money0(outQ.reduce((a, q) => a + qTop(q), 0)) : draftQ ? `${draftQ}` : signedMonth.length ? money0(signedMonth.reduce((a, q) => a + Number(q.signed_total ?? 0), 0)) : "0",
      sub: outQ.length
        ? `${outQ.length} waiting on the customer${draftQ ? ` · ${draftQ} draft${draftQ === 1 ? "" : "s"}` : ""}`
        : draftQ
          ? `draft${draftQ === 1 ? "" : "s"} to finish`
          : signedMonth.length
            ? `signed this month (${signedMonth.length})`
            : "Takeoff to a signed proposal",
      href: "/ops/quotes",
      live: true,
    },
    {
      icon: CalendarRange,
      title: "Schedule",
      value: toSchedule ? `${toSchedule}` : `${thisWeek ?? 0}`,
      sub: toSchedule ? `trip${toSchedule === 1 ? "" : "s"} to schedule${thisWeek ? ` · ${thisWeek} in the next 7 days` : ""}` : thisWeek ? `trip${thisWeek === 1 ? "" : "s"} in the next 7 days` : "Rigs and crews by day",
      href: "/ops/schedule",
      live: opsCan.jobs(role),
    },
    { icon: ClipboardCheck, title: "Work orders", value: "Nov 26", sub: "Time, sets and lots from the field", live: false },
    { icon: Receipt, title: "Invoices", value: "Nov 26", sub: "Deposit to final", live: false },
    { icon: Gauge, title: "Job costing", value: "Dec 1", sub: "Yield and margin on every job", live: false },
  ];

  return (
    <main className="shell wide">
      {alerts}
      {head}

      {steps.length && left ? (
        <section className="card ops-setup">
          <div className="row between" style={{ gap: 12 }}>
            <span className="col tight">
              <b>Get set up ({steps.length - left} of {steps.length} done)</b>
              <span className="tiny faint">About 15 minutes. AMBIT products and your AMBIT prices are already in.</span>
            </span>
          </div>
          <div className="gbar" aria-hidden="true"><div className="fill" style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
          <div className="ops-setup-list">
            {steps.map((x) => (
              <Link key={x.label} href={x.href} className={`ops-setup-row${x.done ? " done" : ""}`}>
                <span className="ops-tick">{x.done ? <Check size={14} strokeWidth={3} /> : null}</span>
                <span className="grow col tight" style={{ minWidth: 0 }}>
                  <span className="t">{x.label}</span>
                  {!x.done ? <span className="tiny faint">{x.hint}</span> : null}
                </span>
                {!x.done ? <ChevronRight size={16} className="faint" /> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="ops-path" aria-label="Your work, start to finish">
        {path.map((p, i) => {
          const I = p.icon;
          const body = (
            <>
              <span className="ops-path-ic"><I size={18} /></span>
              <span className="col tight" style={{ minWidth: 0 }}>
                <span className="tiny faint">{p.title}</span>
                <b className="ops-path-v">{p.value}</b>
                <span className="tiny faint ellipsis">{p.live ? p.sub : `Coming · ${p.sub}`}</span>
              </span>
              {i < path.length - 1 ? <ArrowRight size={14} className="ops-path-arrow" aria-hidden="true" /> : null}
            </>
          );
          return p.live && p.href ? (
            <Link key={p.title} href={p.href} className="ops-path-step live">{body}</Link>
          ) : (
            <div key={p.title} className="ops-path-step">{body}</div>
          );
        })}
      </section>

      <div className="ops-two">
        <section className="card col" style={{ gap: 10 }}>
          <div className="row between">
            <b>Your tasks</b>
            <Link href="/ops/leads/new" className="btn sm"><Plus size={15} /> New lead</Link>
          </div>
          {((tasks ?? []) as unknown as Tk[]).length ? (
            <div className="ops-tasks">
              {((tasks ?? []) as unknown as Tk[]).map((t) => (
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
            <span className="tiny faint">{wonMonth} won this month</span>
          </div>
          {open.length ? (
            <div className="ops-tasks">
              {open.slice(0, 6).map((l) => (
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
        <p>Takeoff is live for AMBIT. Contractors get their own workspace: leads and customers now, quotes, scheduling, work orders, invoices and job costing by Dec 1.</p>
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
