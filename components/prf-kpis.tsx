import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Trophy } from "lucide-react";
import { allRows } from "@/lib/prices";
import { Help } from "@/components/help";

// The numbers at the top of Price approvals: how many came in, how fast they're answered, how good they are, who sends the most.
// Counts price requests made in the app (older Jotform ones aren't scored or timed).

export const KPI_RANGES = [7, 30, 90] as const;
type Pr = { id: number; created_at: string; created_by: string | null; rep_name: string | null; status: string; decided_at: string | null };
type Ln = { request_id: number; requested_price: number; list_price: number | null; auto: boolean; rule: string | null; status: string; basis: string | null };

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const hrs = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h * 10) / 10} hr` : `${Math.round((h / 24) * 10) / 10} days`);

export async function PrfKpis({ supabase, days, href }: { supabase: SupabaseClient; days: number; href: (d: number) => string }) {
  const prs = await allRows<Pr>((f, t) =>
    supabase.from("price_requests").select("id, created_at, created_by, rep_name, status, decided_at").gte("created_at", ago(days * 2)).order("created_at").range(f, t),
  ).catch(() => [] as Pr[]);
  const now = prs.filter((r) => r.created_at >= ago(days));
  const before = prs.filter((r) => r.created_at < ago(days));
  const ids = now.map((r) => r.id);
  const [lines, scores, waitingRes] = await Promise.all([
    ids.length ? allRows<Ln>((f, t) => supabase.from("price_request_lines").select("request_id, requested_price, list_price, auto, rule, status, basis").in("request_id", ids).range(f, t)).catch(() => [] as Ln[]) : Promise.resolve([] as Ln[]),
    ids.length ? allRows<{ request_id: number; score: number }>((f, t) => supabase.from("price_request_scores").select("request_id, score").in("request_id", ids).range(f, t)).catch(() => []) : Promise.resolve([]),
    supabase.from("price_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const live = now.filter((r) => r.status !== "withdrawn");
  const answered = live.filter((r) => r.status !== "pending");
  const yes = answered.filter((r) => r.status === "approved" || r.status === "partly");
  const times = answered.filter((r) => r.decided_at).map((r) => (new Date(r.decided_at!).getTime() - new Date(r.created_at).getTime()) / 36e5).filter((h) => h >= 0);
  const avgHrs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const scoreOf = new Map(scores.map((s) => [s.request_id, Number(s.score)]));
  const sc = [...scoreOf.values()];
  const avgScore = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
  const byReq = new Map<number, Ln[]>();
  for (const l of lines) byReq.set(l.request_id, [...(byReq.get(l.request_id) ?? []), l]);
  const autoAll = answered.filter((r) => (byReq.get(r.id) ?? []).length && (byReq.get(r.id) ?? []).every((l) => l.auto)).length;
  const byScore = answered.filter((r) => (byReq.get(r.id) ?? []).some((l) => /quality score/i.test(l.rule ?? ""))).length;
  // Only items priced the same way as their list price (each, not per lb or sq ft).
  const under = lines
    .filter((l) => (l.basis ?? "unit") === "unit" && Number(l.list_price) > 0 && Number(l.requested_price) > 0 && Number(l.requested_price) <= Number(l.list_price) * 2)
    .map((l) => (1 - Number(l.requested_price) / Number(l.list_price)) * 100);
  const avgUnder = under.length ? Math.round((under.reduce((a, b) => a + b, 0) / under.length) * 10) / 10 : null;
  const delta = live.length - before.filter((r) => r.status !== "withdrawn").length;

  // Reps: who sends the most, how many get approved, and how good they are.
  const reps = new Map<string, { name: string; n: number; yes: number; answered: number; scores: number[] }>();
  for (const r of live) {
    const k = r.created_by ?? r.rep_name ?? "?";
    const x = reps.get(k) ?? { name: r.rep_name ?? "Unknown", n: 0, yes: 0, answered: 0, scores: [] };
    x.n++;
    if (r.status !== "pending") x.answered++;
    if (r.status === "approved" || r.status === "partly") x.yes++;
    const s = scoreOf.get(r.id);
    if (s !== undefined) x.scores.push(s);
    reps.set(k, x);
  }
  const leaders = [...reps.values()].sort((a, b) => b.n - a.n || b.yes - a.yes).slice(0, 5);
  const top = Math.max(1, ...leaders.map((l) => l.n));
  const waiting = waitingRes.count ?? 0;

  const tile = (label: React.ReactNode, value: string, sub: string, tone = "") => (
    <div className={`ihub-kpi${tone ? ` ${tone}` : ""}`}>
      <span className="l">{label}</span>
      <b>{value}</b>
      <span className="s">{sub}</span>
    </div>
  );

  return (
    <section className="prk" aria-label="Price request numbers">
      <div className="prk-h">
        <b className="tg-h" style={{ margin: 0 }}>The last {days} days</b>
        <nav className="seg2 sm" aria-label="Period">
          {KPI_RANGES.map((d) => <Link key={d} href={href(d)} className={d === days ? "on" : undefined} aria-current={d === days ? "true" : undefined} scroll={false}>{d} days</Link>)}
        </nav>
      </div>
      <div className="ihub-kpis prk-kpis">
        {tile("Sent", String(live.length), `${delta > 0 ? "+" : ""}${delta} vs the ${days} days before`)}
        {tile("Waiting now", String(waiting), waiting ? "Need an answer" : "All answered", waiting ? "warn" : "")}
        {tile(<>Approved <Help label="Approved">Price requests approved in full or in part, out of the ones answered in this period.</Help></>, pct(yes.length, answered.length) === null ? "–" : `${pct(yes.length, answered.length)}%`, `${yes.length} of ${answered.length} answered`)}
        {tile(<>Answer time <Help label="Answer time">Average time from when a rep sent it to when it was answered (by a person or automatically).</Help></>, avgHrs === null ? "–" : hrs(avgHrs), "Sent to answered, on average")}
        {tile(<>Quality score <Help label="Quality score">Average quality score (0 to 100) of the requests scored in this period. 85 or better is approved automatically when that rule is on.</Help></>, avgScore === null ? "–" : String(avgScore), `${sc.length} scored`, avgScore !== null && avgScore < 55 ? "warn" : "")}
        {tile(<>Approved automatically <Help label="Approved automatically">Requests the app approved by itself: by the score rule or the % under list rules.</Help></>, pct(autoAll, answered.length) === null ? "–" : `${pct(autoAll, answered.length)}%`, `${autoAll} total · ${byScore} by the score rule`)}
        {tile(<>Asked under list <Help label="Asked under list">On items with a list price, how far under list reps asked, on average.</Help></>, avgUnder === null ? "–" : `${avgUnder}%`, "Average discount asked")}
        {tile("Reps sending", String(reps.size), `${live.length && reps.size ? Math.round((live.length / reps.size) * 10) / 10 : 0} requests each`)}
      </div>
      {leaders.length ? (
        <div className="card2 prk-lead">
          <div className="card2-h"><b><Trophy size={17} aria-hidden="true" /> Most price requests</b><Link href="/price-requests/dashboard" className="b2 quiet sm">Full dashboard</Link></div>
          <div className="prk-rows">
            {leaders.map((l, i) => {
              const avg = l.scores.length ? Math.round(l.scores.reduce((a, b) => a + b, 0) / l.scores.length) : null;
              return (
                <div key={`${l.name}${i}`} className="prk-row">
                  <span className={`prk-rank${i === 0 ? " first" : ""}`}>{i + 1}</span>
                  <b className="prk-name">{l.name}</b>
                  <span className="prk-bar" aria-hidden="true"><i style={{ width: `${(l.n / top) * 100}%` }} /></span>
                  <span className="prk-n"><b>{l.n}</b> sent</span>
                  <span className="prk-m">{pct(l.yes, l.answered) === null ? "None answered yet" : `${pct(l.yes, l.answered)}% approved`}</span>
                  <span className="prk-m">{avg === null ? "No score yet" : `Score ${avg}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
