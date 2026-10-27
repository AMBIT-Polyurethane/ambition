import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { money } from "@/lib/format";
import { GOAL_GROUPS, sum, type GoalPerson } from "@/lib/sales-goals";

// Sales goal progress (0028): how much someone has sold this month in each product group against their goal, with
// a mark for where the month is (if the bar reaches the mark, they're on pace).

const whole = (n: number) => money(Math.round(n)).replace(/\.00$/, "");
export const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

/** One bar: sold against goal, with the pace mark. */
export function GoalBar({ sold, goal, gone, label }: { sold: number; goal: number; gone: number; label: string }) {
  const p = goal > 0 ? sold / goal : 0;
  return (
    <span className="gbar" role="img" aria-label={`${label}: ${whole(sold)} of ${whole(goal)} (${Math.round(p * 100)}%); ${Math.round(gone * 100)}% of the month gone`}>
      <i className={`fill${p >= 1 ? " done" : ""}`} style={{ width: `${Math.min(100, p * 100)}%` }} />
      {gone > 0 && gone < 1 ? <i className="mark" style={{ left: `${gone * 100}%` }} /> : null}
    </span>
  );
}

/** One person's month: the total, then each product group with a goal (or sales). */
export function GoalCardBody({ p, gone, compact }: { p: GoalPerson; gone: number; compact?: boolean }) {
  const goal = sum(p.goals);
  const sold = sum(p.sold);
  const rows = GOAL_GROUPS.filter((g) => (p.goals[g.key] ?? 0) > 0 || (p.sold[g.key] ?? 0) > 0);
  const pace = goal * gone;
  return (
    <div className="goal-body">
      <div className="wg-big">
        <b>{whole(sold)}</b>
        <span className="small muted">
          {goal ? (
            <>
              {pctOf(sold, goal)}% of the {whole(goal)} goal ·{" "}
              {gone >= 1 ? (sold >= goal ? "goal met" : `${whole(goal - sold)} short`) : sold >= pace ? "on pace" : `${whole(pace - sold)} behind pace`}
            </>
          ) : (
            "sold this month (no goal set)"
          )}
        </span>
      </div>
      {goal ? <GoalBar sold={sold} goal={goal} gone={gone} label="All products" /> : null}
      {rows.length ? (
        <ul className="goal-rows">
          {rows.map((g) => {
            const gl = p.goals[g.key] ?? 0;
            const sd = p.sold[g.key] ?? 0;
            return (
              <li key={g.key}>
                <span className="row between" style={{ gap: 8 }}>
                  <span className="ellipsis">{compact ? g.short : g.label}</span>
                  <span className="v">
                    {gl > 0 && sd >= gl ? <CircleCheck size={13} className="ok" aria-label="Goal met" /> : null} <b>{whole(sd)}</b>
                    {gl > 0 ? <span className="faint"> / {whole(gl)}</span> : null}
                  </span>
                </span>
                {gl > 0 ? <GoalBar sold={sd} goal={gl} gone={gone} label={g.label} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Nothing sold yet this month.</p>
      )}
      {p.waiting ? (
        <p className="tiny" style={{ margin: 0, color: "var(--warn-text)" }}>
          {p.waiting} {p.waiting === 1 ? "order is" : "orders are"} waiting for the order desk to enter invoice prices; {p.waiting === 1 ? "it counts" : "they count"} once priced.
        </p>
      ) : null}
    </div>
  );
}

/** Admin: everyone's month in one list, each a bar against their whole goal. */
export function TeamGoals({ people, gone, href }: { people: GoalPerson[]; gone: number; href?: (p: GoalPerson) => string }) {
  return (
    <ul className="team-goals">
      {people.map((p) => {
        const goal = sum(p.goals);
        const sold = sum(p.sold);
        const inner = (
          <>
            <span className="row between" style={{ gap: 8 }}>
              <span className="ellipsis"><b>{p.name}</b> <span className="faint tiny">{p.basis === "branch" ? (p.branch_id ?? "").toUpperCase() : "Rep"}</span></span>
              <span className="v">
                <b>{whole(sold)}</b>
                {goal ? <span className="faint"> · {pctOf(sold, goal)}%</span> : <span className="faint"> · no goal</span>}
              </span>
            </span>
            {goal ? <GoalBar sold={sold} goal={goal} gone={gone} label={p.name} /> : null}
          </>
        );
        return <li key={p.id}>{href ? <Link href={href(p)}>{inner}</Link> : inner}</li>;
      })}
    </ul>
  );
}
