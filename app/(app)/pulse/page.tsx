import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { PULSE_DEPTS, SPECS } from "@/lib/forms/specs";
import { str, type Data } from "@/lib/forms/engine";
import { TopBar } from "@/components/ui";
import { setPulseDept } from "./actions";

export const metadata = { title: "Daily Pulse" };
export const dynamic = "force-dynamic";

type Row = { id: number; form_key: string; data: Data; score: number | null; submitted_by: string | null; for_day: string; submitted_at: string | null };
type Person = { id: string; full_name: string | null; email: string; pulse_dept: string | null };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shift = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const tone = (n: number | null) => (n === null ? "faint" : n >= 85 ? "ok-text" : n >= 60 ? "warn-text" : "red");

/** Leadership's view of every Daily Pulse: who's in, the scores, the alerts, and two weeks of trend. */
export default async function PulsePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (profile.role !== "admin") redirect("/forms");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const day = sp.day && DAY.test(sp.day) ? sp.day : today;
  const from = shift(day, -13);
  const [{ data: subs }, { data: ppl }] = await Promise.all([
    supabase.from("form_submissions").select("id, form_key, data, score, submitted_by, for_day, submitted_at").like("form_key", "pulse_%").eq("status", "submitted").gte("for_day", from).lte("for_day", day).order("for_day"),
    supabase.from("profiles").select("id, full_name, email, pulse_dept").in("role", ["employee", "admin"]).eq("status", "active").order("full_name"),
  ]);
  const rows = (subs ?? []) as Row[];
  const people = (ppl ?? []) as Person[];
  const name = new Map(people.map((p) => [p.id, p.full_name || p.email]));
  const todays = rows.filter((r) => r.for_day === day);
  const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
  const expected = weekend ? [] : people.filter((p) => p.pulse_dept);
  const inToday = new Set(todays.map((r) => r.submitted_by));
  const avg = todays.length ? Math.round(todays.reduce((s, r) => s + (r.score ?? 0), 0) / todays.length) : null;
  const flags = rows.filter((r) => r.for_day >= shift(day, -6)).flatMap((r) => (SPECS[r.form_key]?.score?.(r.data).flags ?? []).filter((f) => f !== "Blocked").map((f) => ({ f, r })));
  const days = Array.from({ length: 14 }, (_, i) => shift(from, i));
  const byPerson = new Map<string, Map<string, Row>>();
  for (const r of rows) if (r.submitted_by) { if (!byPerson.has(r.submitted_by)) byPerson.set(r.submitted_by, new Map()); byPerson.get(r.submitted_by)!.set(r.for_day, r); }

  return (
    <main className="shell wide">
      <TopBar title="Daily Pulse" back="/forms" />
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <Link href={`/pulse?day=${shift(day, -1)}`} className="btn sm dark" aria-label="Day before"><ChevronLeft size={15} /></Link>
          <b>{day === today ? "Today" : nice(day)}</b>
          {day < today ? <Link href={`/pulse?day=${shift(day, 1)}`} className="btn sm dark" aria-label="Next day"><ChevronRight size={15} /></Link> : null}
        </div>
        <span className="tiny faint">People fill it in from Forms or their Home screen, once a day.</span>
      </div>
      <div className="cr-kpis">
        <div className={`cr-kpi${expected.length && inToday.size < expected.length ? " warn" : " good"}`}><span className="tiny">Pulses in</span><b>{todays.length}{expected.length ? ` / ${expected.length}` : ""}</b><span className="tiny">{weekend ? "Weekend: nobody's expected" : `${expected.length - expected.filter((p) => inToday.has(p.id)).length} still missing`}</span></div>
        <div className="cr-kpi"><span className="tiny">Average score</span><b className={tone(avg)}>{avg === null ? "–" : `${avg}%`}</b><span className="tiny">across everyone today</span></div>
        <div className={`cr-kpi${flags.length ? " bad" : " good"}`}><span className="tiny">Alerts, last 7 days</span><b>{flags.length}</b><span className="tiny">safety, leadership, equipment, customers</span></div>
      </div>

      {flags.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b className="small">Alerts</b>
          {flags.slice(-12).reverse().map(({ f, r }) => (
            <Link key={`${r.id}-${f}`} href={`/forms/s/${r.id}`} className="pulse-alert">
              <TriangleAlert size={16} className="red" />
              <span className="col tight grow" style={{ minWidth: 0 }}><b className="small">{f} · {name.get(r.submitted_by ?? "") ?? "Someone"}</b>
                <span className="tiny muted ellipsis">{str(r.data.safety_why) || str(r.data.lead_why) || str(r.data.equip_why) || str(r.data.resolution_why) || str(r.data.lost_why) || "–"}</span></span>
              <span className="tiny faint">{nice(r.for_day)}</span>
            </Link>
          ))}
        </section>
      ) : null}

      {(Object.keys(PULSE_DEPTS) as (keyof typeof PULSE_DEPTS)[]).map((dept) => {
        const team = weekend ? people.filter((p) => p.pulse_dept === dept && inToday.has(p.id)) : people.filter((p) => p.pulse_dept === dept);
        const extra = todays.filter((r) => r.form_key === `pulse_${dept}` && !team.some((p) => p.id === r.submitted_by));
        if (!team.length && !extra.length) return null;
        return (
          <section key={dept} className="card col" style={{ gap: 10 }}>
            <div className="row between"><b>{PULSE_DEPTS[dept]}</b><span className="tiny faint">{team.filter((p) => inToday.has(p.id)).length} of {team.length} in</span></div>
            <div className="pulse-grid">
              <span className="tiny faint">Person</span><span className="tiny faint">Score</span><span className="tiny faint">Top items</span>
              <span className="tiny faint pulse-trend-h">Last 14 days</span>
              {[...team.map((p) => p.id), ...extra.map((r) => r.submitted_by!)].map((pid) => {
                const r = todays.find((x) => x.submitted_by === pid && x.form_key === `pulse_${dept}`) ?? todays.find((x) => x.submitted_by === pid);
                const sc = r ? SPECS[r.form_key]?.score?.(r.data) : null;
                const hist = byPerson.get(pid);
                return (
                  <div key={pid} className="pulse-row">
                    <span className="small"><b>{name.get(pid) ?? "–"}</b></span>
                    <span>{r ? <Link href={`/forms/s/${r.id}`} className={`pulse-score ${tone(r.score)}`}>{r.score}%</Link> : <span className="pill grey">Not in yet</span>}</span>
                    <span className="tiny col tight" style={{ minWidth: 0 }}>
                      {r ? [str(r.data.item1), str(r.data.item2), str(r.data.item3)].filter(Boolean).map((t, i) => <span key={i} className="ellipsis">{i + 1}. {t}</span>) : <span className="faint">–</span>}
                      {sc?.flags.length ? <span className="row wrap" style={{ gap: 4 }}>{sc.flags.map((f) => <span key={f} className="pill red">{f}</span>)}</span> : null}
                    </span>
                    <span className="pulse-trend" role="img" aria-label={`Scores for the last 14 days: ${days.map((d) => hist?.get(d)?.score ?? "none").join(", ")}`}>
                      {days.map((d) => { const s = hist?.get(d)?.score ?? null; return <i key={d} title={`${nice(d)}: ${s === null ? "no pulse" : `${s}%`}`} className={s === null ? "none" : s >= 85 ? "hi" : s >= 60 ? "mid" : "lo"} style={{ height: s === null ? 3 : `${Math.max(12, s)}%` }} />; })}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <details className="card">
        <summary><b>Who fills in which pulse</b> <span className="tiny faint">· {expected.length} people</span></summary>
        <form action={setPulseDept} className="col" style={{ gap: 6, marginTop: 12 }}>
          {people.map((p) => (
            <label key={p.id} className="row between" style={{ gap: 10 }}>
              <span className="small">{p.full_name || p.email}</span>
              <select className="select sm" name={`d:${p.id}`} defaultValue={p.pulse_dept ?? ""} style={{ width: 240 }}>
                <option value="">Doesn&apos;t fill one in</option>
                {Object.entries(PULSE_DEPTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          ))}
          <button type="submit" className="btn sm" style={{ alignSelf: "flex-start" }}>Save</button>
        </form>
      </details>
    </main>
  );
}
