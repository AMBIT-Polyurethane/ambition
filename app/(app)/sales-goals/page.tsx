import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireActive } from "@/lib/session";
import { money } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { GOAL_GROUPS, monthGone, sum } from "@/lib/sales-goals";
import { goalBoard } from "@/lib/sales-goals-server";
import { TopBar } from "@/components/ui";
import { GoalBar, GoalCardBody, pctOf } from "@/components/goal-views";

export const metadata = { title: "Sales goals" };

const whole = (n: number) => money(Math.round(n)).replace(/\.00$/, "");
const shift = (m: string, by: number) => {
  const d = new Date(`${m}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Sales goals: admins see everyone (a table by product group); reps and warehouse managers see their own month. */
export default async function SalesGoalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const admin = profile.role === "admin";
  if (!admin && profile.role !== "employee") redirect("/");
  const today = todayCentral();
  const now = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? "") && sp.m! <= now ? sp.m! : now;
  const who = admin && /^[0-9a-f-]{36}$/i.test(sp.p ?? "") ? sp.p! : null;
  const board = await goalBoard(supabase, `${month}-01`, who);
  const gone = monthGone(month, today);
  const q = (m: string) => `/sales-goals?m=${m}${who ? `&p=${who}` : ""}`;
  const people = board?.people ?? [];
  const me = people.find((p) => p.id === profile.id);
  if (!admin && (!me || (!sum(me.goals) && !sum(me.sold) && me.job_role !== "sales_rep" && me.job_role !== "warehouse"))) redirect("/");

  return (
    <main className={`shell goal-page${admin && !who ? " wide" : ""}`}>
      <TopBar
        title={who ? people[0]?.name ?? "Sales goals" : admin ? "Sales goals" : "Your sales goals"}
        back={who ? `/sales-goals?m=${month}` : "/"}
        right={admin ? <Link href="/admin/sales-goals" className="btn sm dark">Set goals</Link> : null}
      />
      <div className="row between" style={{ gap: 8 }}>
        <Link href={q(shift(month, -1))} className="iconbtn" aria-label="Previous month"><ChevronLeft size={20} /></Link>
        <b>{monthName(month)}{month === now ? " · so far" : ""}</b>
        {month < now ? <Link href={q(shift(month, 1))} className="iconbtn" aria-label="Next month"><ChevronRight size={20} /></Link> : <span style={{ width: 40 }} />}
      </div>
      {!board ? <div className="alert warn small">Sales goals need database update 0028.</div> : null}

      {admin && !who ? (
        people.length ? (
          <div className="tbl-wrap">
            <table className="goal-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">All products</th>
                  {GOAL_GROUPS.map((g) => <th key={g.key} className="num">{g.short}</th>)}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const goal = sum(p.goals);
                  const sold = sum(p.sold);
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/sales-goals?m=${month}&p=${p.id}`}><b>{p.name}</b></Link>
                        <div className="tiny faint">{p.basis === "branch" ? `Warehouse · ${(p.branch_id ?? "").toUpperCase()}` : "Sales rep"} · {p.orders} {p.orders === 1 ? "order" : "orders"}{p.waiting ? ` · ${p.waiting} unpriced` : ""}</div>
                      </td>
                      <Cell sold={sold} goal={goal} gone={gone} strong />
                      {GOAL_GROUPS.map((g) => <Cell key={g.key} sold={p.sold[g.key] ?? 0} goal={p.goals[g.key] ?? 0} gone={gone} />)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card small muted">No sales reps or warehouse managers yet.</div>
        )
      ) : me || who ? (
        <section className="wg">
          <GoalCardBody p={(who ? people[0] : me)!} gone={gone} />
        </section>
      ) : null}

      <p className="tiny faint" style={{ margin: 0 }}>
        Sales reps: their customers&apos; orders. Warehouse managers: every order from their location. Orders count in the month they were placed, at
        the prices the order desk enters from the invoice (cancelled orders don&apos;t count). The line on each bar is where the month is: reach it and
        you&apos;re on pace.
      </p>
    </main>
  );
}

function Cell({ sold, goal, gone, strong }: { sold: number; goal: number; gone: number; strong?: boolean }) {
  if (!goal && !sold) return <td className="num faint">–</td>;
  return (
    <td className="num">
      {strong ? <b>{whole(sold)}</b> : whole(sold)}
      {goal ? <div className="tiny faint">{pctOf(sold, goal)}% of {whole(goal)}</div> : <div className="tiny faint">no goal</div>}
      {goal ? <GoalBar sold={sold} goal={goal} gone={gone} label="" /> : null}
    </td>
  );
}
