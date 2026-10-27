import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { roleLabel } from "@/lib/access";
import { money } from "@/lib/format";
import { GOAL_GROUPS, sum } from "@/lib/sales-goals";
import { goalBoard } from "@/lib/sales-goals-server";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { saveGoals } from "@/app/(app)/admin/actions";

export const metadata = { title: "Sales goals" };

const whole = (n: number) => money(Math.round(n)).replace(/\.00$/, "");

/** Admin: each sales rep's and warehouse manager's monthly goal for each product group. */
export default async function SalesGoalsAdmin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [board, { data: staffRows }, { data: repRows }, { data: branches }, extra] = await Promise.all([
    goalBoard(supabase),
    supabase.from("profiles").select("id, full_name, email, job_role").in("role", ["employee", "admin"]).eq("status", "active").order("full_name"),
    supabase.from("companies").select("sales_rep_id").not("sales_rep_id", "is", null).eq("active", true).limit(5000),
    supabase.from("branches").select("id, name"),
    sp.add ? goalBoard(supabase, null, sp.add) : Promise.resolve(null),
  ]);
  if (!board) {
    return (
      <main className="shell">
        <TopBar title="Sales goals" back="/admin" />
        <div className="alert warn small">Run database update 0028 first (Supabase → SQL Editor).</div>
      </main>
    );
  }
  const people = [...board.people, ...(extra?.people ?? []).filter((p) => !board.people.some((x) => x.id === p.id))];
  const customers = new Map<string, number>();
  for (const r of (repRows ?? []) as { sales_rep_id: string }[]) customers.set(r.sales_rep_id, (customers.get(r.sales_rep_id) ?? 0) + 1);
  const branchName = new Map(((branches ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const others = ((staffRows ?? []) as { id: string; full_name: string | null; email: string; job_role: string | null }[]).filter((p) => !people.some((x) => x.id === p.id));

  return (
    <main className="shell wide">
      <TopBar title="Sales goals" back="/admin" right={<Link href="/sales-goals" className="btn sm dark">See progress</Link>} />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={18} style={{ flex: "none" }} /><span>{sp.err}</span></div> : null}
      <div className="card small col" style={{ gap: 6 }}>
        <b>How goals work</b>
        <span>
          Type each person&apos;s goal for a month, in dollars, for each product group (leave a box blank for no goal), then Save. The same goals
          apply every month. <b>Sales reps</b> are measured on their customers&apos; orders (set each customer&apos;s rep in{" "}
          <Link href="/admin/companies?rep=none">Admin → Customers</Link>). <b>Warehouse managers</b> are measured on every order from their location.
          Orders count in the month they&apos;re placed, at the prices the order desk enters from the invoice. Which group a product counts toward
          is set per category in <Link href="/admin/products">Products &amp; pricing → Categories</Link>.
        </span>
      </div>

      {people.length === 0 ? <div className="card small muted">No sales reps or warehouse managers yet. Give someone that job role in Admin → Accounts.</div> : null}

      <div className="goal-admin">
        {people.map((p) => {
          const total = sum(p.goals);
          return (
            <form key={p.id} id={`p-${p.id}`} action={saveGoals} className="card col goal-form" style={{ gap: 12 }}>
              <input type="hidden" name="person" value={p.id} />
              <input type="hidden" name="name" value={p.name} />
              <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
                <div className="col" style={{ gap: 2 }}>
                  <b>{p.name}</b>
                  <span className="tiny faint">
                    {roleLabel(p.job_role) ?? "Staff"} ·{" "}
                    {p.basis === "branch"
                      ? `every order from ${branchName.get(p.branch_id ?? "") ?? "their location (set a branch in Admin → Accounts)"}`
                      : `${customers.get(p.id) ?? 0} ${customers.get(p.id) === 1 ? "customer" : "customers"} assigned`}
                  </span>
                </div>
                <span className="small" style={{ whiteSpace: "nowrap" }}>
                  {total ? <>Monthly goal <b>{whole(total)}</b></> : <span className="faint">No goals yet</span>}
                </span>
              </div>
              <div className="goal-grid">
                {GOAL_GROUPS.map((g) => (
                  <label key={g.key} className="field">
                    <span className="label">{g.label}</span>
                    <span className="price-in">
                      <span aria-hidden="true">$</span>
                      <input className="input sm" name={`g_${g.key}`} inputMode="decimal" defaultValue={p.goals[g.key] ? String(Math.round(Number(p.goals[g.key]))) : ""} placeholder="None" />
                    </span>
                  </label>
                ))}
              </div>
              <div><Submit className="btn sm" pendingText="Saving…">Save goals</Submit></div>
            </form>
          );
        })}
      </div>

      {others.length ? (
        <form action="/admin/sales-goals" className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select className="select sm" name="add" defaultValue="" aria-label="Give goals to someone else" style={{ width: "auto", minWidth: 240 }}>
            <option value="" disabled>Give goals to someone else on staff…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.full_name?.trim() || o.email}{roleLabel(o.job_role) ? ` (${roleLabel(o.job_role)})` : ""}</option>)}
          </select>
          <button type="submit" className="btn sm dark">Add</button>
        </form>
      ) : null}
    </main>
  );
}
