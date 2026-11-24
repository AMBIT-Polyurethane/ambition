import Link from "next/link";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canSalesAll } from "@/lib/access";
import { CRM_NEEDS, repList, todayCentral } from "@/lib/crm";
import { HEALTH, kmoney, type CrmCustomer } from "@/lib/crm-shared";
import { dateShort } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { BarList, ColumnChart } from "@/components/inventory/charts";
import { SalesNav } from "@/components/sales/sales-nav";
import { CustomerTable } from "@/components/sales/customer-table";
import { HealthPill } from "@/components/sales/bits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales dashboard" };

type Rep = { id: string; name: string | null; goal: number | null; customers: number; sales_mtd: number; sales_12m: number; active: number; new: number; quiet: number; touches: number; est_sent: number; est_won: number };
type Board = {
  reps: Rep[];
  customers: CrmCustomer[];
  months: { month: string; start: string; sales: number; goal: number | null }[];
  groups: { group: string; sales: number }[];
  open_estimates: { n: number; total: number };
  history: { through_date: string | null } | null;
};
const GROUP: Record<string, string> = { foam: "Spray foam", fiberglass: "Fiberglass", ppe: "PPE", roof: "Roof coatings", guns: "Guns & parts", intumescent: "Intumescent", sealants: "Sealants", supplies: "Supplies", other: "Other" };

/** Admins: every rep side by side, the company's months, and every customer (with assigning). */
export default async function SalesDashboardPage() {
  const { supabase, profile } = await requireEmployee();
  if (!canSalesAll(profile)) redirect("/sales");
  const [{ data, error }, reps] = await Promise.all([supabase.rpc("crm_board"), repList(supabase)]);
  if (error || !data) {
    return (
      <main className="shell full crm">
        <TopBar title="Sales dashboard" />
        <SalesNav on="dashboard" all admin={profile.role === "admin"} />
        <div className="alert warn small">{/crm_board|schema cache|function/i.test(error?.message ?? "") ? CRM_NEEDS : error?.message ?? "Couldn't load the dashboard."}</div>
      </main>
    );
  }
  const b = data as Board;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const customers = b.customers.map((c) => ({ ...c, sales_12m: n(c.sales_12m), sales_mtd: n(c.sales_mtd), sales_90d: n(c.sales_90d), sales_prev_90d: n(c.sales_prev_90d), orders_12m: n(c.orders_12m), monthly: (c.monthly ?? []).map(n) }));
  const repsRows = b.reps.map((r) => ({ ...r, goal: r.goal === null ? null : n(r.goal), sales_mtd: n(r.sales_mtd), sales_12m: n(r.sales_12m) }));
  const mtd = customers.reduce((s, c) => s + c.sales_mtd, 0);
  const goal = b.months[b.months.length - 1]?.goal ? n(b.months[b.months.length - 1].goal) : 0;
  const y = customers.reduce((s, c) => s + c.sales_12m, 0);
  const risk = customers.filter((c) => c.status === "at_risk");
  const unassigned = customers.filter((c) => !c.rep_id && !c.house && c.sales_12m > 0).length;
  const today = todayCentral();
  const d = new Date(`${today}T12:00:00`);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const pace = goal ? mtd / goal / (d.getDate() / dim) : null;
  const tile = (label: string, value: string, sub: string, tone = "") => (
    <div className={`ihub-kpi${tone ? ` ${tone}` : ""}`}><span className="l">{label}</span><b>{value}</b><span className="s">{sub}</span></div>
  );
  const top = Math.max(1, ...repsRows.map((r) => r.sales_mtd));

  return (
    <main className="shell full crm">
      <TopBar title="Sales dashboard" />
      <SalesNav on="dashboard" all admin={profile.role === "admin"} />
      {!b.history?.through_date ? (
        <div className="alert small" role="note">
          <Info size={16} style={{ flex: "none", marginTop: 2 }} />
          <span>Only A.I. orders so far (since late October). {profile.role === "admin" ? <Link href="/sales/import">Import the QuickBooks sales history</Link> : "An admin can import the QuickBooks sales history"} for real trends and health.</span>
        </div>
      ) : null}
      <div className="ihub-kpis">
        {tile("Sales this month", kmoney(mtd), goal ? `${Math.round((mtd / goal) * 100)}% of the ${kmoney(goal)} goal${pace !== null ? ` · ${pace >= 1 ? "on pace" : "behind pace"}` : ""}` : "No goals set", pace !== null && pace < 0.85 ? "warn" : "")}
        {tile("Last 12 months", kmoney(y), b.history?.through_date ? `QuickBooks through ${dateShort(b.history.through_date)}, then A.I.` : "A.I. orders only")}
        {tile("Active customers", String(customers.filter((c) => c.days_since !== null && c.days_since <= 90).length), `of ${customers.length} ordered in 90 days`)}
        {tile("At risk", String(risk.length), `${kmoney(risk.reduce((s, c) => s + c.sales_12m, 0))} a year between them`, risk.length ? "warn" : "")}
        {tile("New this month", String(customers.filter((c) => c.first_day && c.first_day >= today.slice(0, 8) + "01").length), "First order this month")}
        {tile("Open estimates", String(n(b.open_estimates?.n)), `${kmoney(n(b.open_estimates?.total))} not ordered yet`)}
        {tile("Calls & visits", String(repsRows.reduce((s, r) => s + n(r.touches), 0)), "Logged this month")}
        {tile("No rep", String(unassigned), "Customers with sales and no rep (pick them below)", unassigned ? "warn" : "")}
      </div>

      <section className="card2" aria-label="Reps">
        <div className="card2-h"><b>Reps this month</b><span className="small faint">Click a rep to open their hub</span></div>
        <div className="tbl-wrap">
          <table className="tbl crm-tbl">
            <thead>
              <tr><th>Rep</th><th>This month</th><th className="num">Goal</th><th className="num">12 months</th><th className="num">Customers</th><th className="num">Active</th><th className="num">New</th><th className="num">Going quiet</th><th className="num">Calls &amp; visits</th><th className="num">Estimates sent / won</th></tr>
            </thead>
            <tbody>
              {repsRows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/sales?rep=${r.id}`} className="crm-name">{r.name}</Link></td>
                  <td style={{ minWidth: 180 }}>
                    <span className="crm-rep-bar"><i style={{ width: `${(r.sales_mtd / top) * 100}%` }} /></span>
                    <b className="small">{kmoney(r.sales_mtd)}</b>
                  </td>
                  <td className="num small">{r.goal ? `${Math.round((r.sales_mtd / r.goal) * 100)}% of ${kmoney(r.goal)}` : <span className="faint">–</span>}</td>
                  <td className="num">{kmoney(r.sales_12m)}</td>
                  <td className="num">{r.customers}</td>
                  <td className="num">{r.active}</td>
                  <td className="num">{r.new}</td>
                  <td className="num">{r.quiet ? <span className="warn-text">{r.quiet}</span> : 0}</td>
                  <td className="num">{r.touches}</td>
                  <td className="num">{r.est_sent} / {r.est_won}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ihub-grid">
        <section className="card2 ihub-card" aria-label="Company sales by month">
          <div className="ihub-card-h"><b>Company sales by month</b><span>Last 12 months{goal ? " · against the monthly goal" : ""}</span></div>
          <ColumnChart
            rows={b.months.map((m) => ({ label: m.month, values: goal ? [n(m.sales), n(m.goal)] : [n(m.sales)] }))}
            series={goal ? [{ key: "s", label: "Sales" }, { key: "g", label: "Goal" }] : [{ key: "s", label: "Sales" }]}
            caption="Company sales by month"
          />
        </section>
        <section className="card2 ihub-card" aria-label="This month by product group">
          <div className="ihub-card-h"><b>This month by product group</b></div>
          {b.groups.length ? <BarList rows={b.groups.map((g) => ({ label: GROUP[g.group] ?? g.group, value: n(g.sales) }))} caption="This month by product group" /> : <p className="small muted" style={{ margin: 0 }}>No sales yet this month.</p>}
        </section>
        <section className="card2 ihub-card wide" aria-label="Biggest customers at risk">
          <div className="ihub-card-h"><b>Biggest customers at risk</b><span>{HEALTH.at_risk.hint}</span></div>
          {risk.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Customer</th><th>Rep</th><th>Health</th><th className="num">Days since</th><th className="num">Usually</th><th className="num">12 months</th></tr></thead>
                <tbody>
                  {[...risk].sort((a, c) => c.sales_12m - a.sales_12m).slice(0, 12).map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/sales/customers/${c.id}`}>{c.name}</Link></td>
                      <td className="small">{c.house ? "House" : c.rep_name ?? "None"}</td>
                      <td><HealthPill status={c.status} /></td>
                      <td className="num">{c.days_since}</td>
                      <td className="num">{c.usual_gap ? `${c.usual_gap} days` : "–"}</td>
                      <td className="num"><b>{kmoney(c.sales_12m)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Nobody is at risk right now.</p>
          )}
        </section>
      </div>

      <section className="col" style={{ gap: 10 }} aria-label="Every customer">
        <b style={{ fontSize: 18 }}>Every customer</b>
        <span className="small muted">Tick customers to give them to a rep or make them House accounts.</span>
        <CustomerTable rows={customers} showRep reps={reps} canAssign />
      </section>
    </main>
  );
}
