import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarClock, FileText, Mail, NotebookPen, Phone, ShoppingCart, UserRound } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can, canEstimate, canSalesAll, canSalesHub } from "@/lib/access";
import { claudeReady } from "@/lib/ai/claude";
import { crmActivities, crmCustomers, crmTasks, todayCentral } from "@/lib/crm";
import { readNote, type CustomerRead } from "@/lib/crm-ai";
import { HEALTH, kmoney, monthLabels, sinceText } from "@/lib/crm-shared";
import { dateShort, money } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { BarList, ColumnChart } from "@/components/inventory/charts";
import { CustomerReadCard } from "@/components/sales/ai-cards";
import { ActivityList, LogForm, TaskList } from "@/components/sales/activity";
import { HealthPill, Trend } from "@/components/sales/bits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

type Product = { product_id: string | null; sku: string | null; name: string; category: string | null; total: number; orders: number; last: string };

/** One customer, from the rep's side: how they're doing, what they buy, what was said, what's next. */
export default async function SalesCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, profile } = await requireEmployee();
  if (!canSalesHub(profile)) redirect("/");
  const today = todayCentral();
  const [{ rows, error }, prod, acts, tasks, read, orders] = await Promise.all([
    crmCustomers(supabase, null, id),
    supabase.rpc("crm_customer_products", { p_company: id }),
    crmActivities(supabase, { company: id, limit: 40 }),
    crmTasks(supabase, null, { company: id }),
    readNote<CustomerRead>(supabase, "customer", `${id}:${today}`),
    supabase.from("orders").select("id, order_no, created_at, est_subtotal, stage, status").eq("company_id", id).order("created_at", { ascending: false }).limit(8),
  ]);
  if (error) return <main className="shell"><TopBar title="Customer" back="/sales" /><div className="alert warn small">{error}</div></main>;
  const c = rows[0];
  if (!c) {
    return (
      <main className="shell">
        <TopBar title="Customer" back="/sales" />
        <div className="alert warn small">That customer isn&apos;t on your list. {canSalesAll(profile) ? "" : "Ask an admin to assign it to you."}</div>
      </main>
    );
  }
  const products = ((prod.data ?? []) as Product[]).map((p) => ({ ...p, total: Number(p.total), orders: Number(p.orders) }));
  const labels = monthLabels();
  const h = HEALTH[c.status];
  const credit = can(profile, "credit_check") || can(profile, "order_desk") || profile.role === "admin";
  const tile = (label: string, value: React.ReactNode, sub: React.ReactNode, tone = "") => (
    <div className={`ihub-kpi${tone ? ` ${tone}` : ""}`}><span className="l">{label}</span><b>{value}</b><span className="s">{sub}</span></div>
  );

  return (
    <main className="shell full crm">
      <TopBar title={c.name} back="/sales" />
      <div className="crm-head">
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <HealthPill status={c.status} />
            <span className="small muted">{h.hint}</span>
          </div>
          <span className="small muted">
            {[c.city && `${c.city}${c.state ? `, ${c.state}` : ""}`, c.house ? "House account" : c.rep_name ? `Rep: ${c.rep_name}` : "No rep yet"].filter(Boolean).join(" · ")}
          </span>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            {c.contact ? <span className="small"><UserRound size={14} aria-hidden /> {c.contact}</span> : null}
            {c.phone ? <a className="small" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}><Phone size={14} aria-hidden /> {c.phone}</a> : null}
            {c.email ? <a className="small" href={`mailto:${c.email.split(/[,;\s]/)[0]}`}><Mail size={14} aria-hidden /> {c.email.split(/[,;\s]/)[0]}</a> : null}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {canEstimate(profile) ? <Link href={`/estimates/new?company=${c.id}`} className="b2 sm"><FileText size={15} /> New estimate</Link> : null}
          {can(profile, "ordering") ? <Link href={`/order?company=${c.id}`} className="b2 quiet sm"><ShoppingCart size={15} /> Place an order</Link> : null}
          {credit ? <Link href={`/customers/${c.id}`} className="b2 quiet sm">Account &amp; balances</Link> : null}
        </div>
      </div>

      <div className="ihub-kpis">
        {tile("Last 12 months", kmoney(c.sales_12m), `${c.orders_12m} order day${c.orders_12m === 1 ? "" : "s"}`)}
        {tile("Last order", sinceText(c.days_since), c.last_day ? dateShort(c.last_day) : "No orders on file", c.status === "at_risk" ? "warn" : "")}
        {tile("Usually orders every", c.usual_gap ? `${c.usual_gap} days` : "–", c.usual_gap ? (c.days_since !== null && c.days_since > c.usual_gap ? `${c.days_since - c.usual_gap} days past that` : "On rhythm") : "Needs 3 or more orders to tell")}
        {tile("Last 90 days", kmoney(c.sales_90d), <>vs {kmoney(c.sales_prev_90d)} the 90 before · <Trend now={c.sales_90d} before={c.sales_prev_90d} /></>)}
      </div>

      <div className="ihub-grid">
        <CustomerReadCard company={c.id} initial={read?.body ?? null} at={read?.created_at ?? null} aiReady={claudeReady()} />
        <section className="card2 ihub-card" aria-label="Sales by month">
          <div className="ihub-card-h"><b>Sales by month</b><span>Customer since {c.first_day ? dateShort(c.first_day) : "–"}</span></div>
          <ColumnChart rows={labels.map((label, i) => ({ label, values: [c.monthly[i] ?? 0] }))} series={[{ key: "s", label: "Sales" }]} caption={`${c.name} sales by month`} />
        </section>
        <section className="card2 ihub-card" aria-label="What they buy">
          <div className="ihub-card-h"><b>What they buy</b><span>Last 12 months</span></div>
          {products.length ? (
            <BarList rows={products.slice(0, 12).map((p) => ({ label: p.sku ? `${p.sku} ${p.name}` : p.name, value: p.total, note: `${p.orders} order${p.orders === 1 ? "" : "s"}, last ${dateShort(p.last)}` }))} caption="What they buy" />
          ) : (
            <p className="small muted" style={{ margin: 0 }}>No sales on file in the last 12 months.</p>
          )}
        </section>
        <section className="card2" aria-label="Follow-ups">
          <div className="card2-h"><b><CalendarClock size={17} aria-hidden /> Follow-ups</b></div>
          <div className="crm-pad"><TaskList tasks={tasks} company={c.id} today={today} /></div>
        </section>
        <section className="card2" aria-label="Log a call or visit">
          <div className="card2-h"><b><NotebookPen size={17} aria-hidden /> Log a call, visit or note</b></div>
          <div className="crm-pad"><LogForm company={c.id} /></div>
        </section>
        <section className="card2" aria-label="History">
          <div className="card2-h"><b>Calls, visits and notes</b><span className="small faint">{acts.length}</span></div>
          <div className="crm-pad"><ActivityList items={acts} /></div>
        </section>
        <section className="card2 ihub-card wide" aria-label="Recent orders in A.I.">
          <div className="ihub-card-h"><b>Recent orders in A.I.</b></div>
          {(orders.data ?? []).length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Order</th><th>Placed</th><th>Status</th><th className="num">Subtotal</th></tr></thead>
                <tbody>
                  {((orders.data ?? []) as { id: string; order_no: number; created_at: string; est_subtotal: number | null; stage: string | null; status: string }[]).map((o) => (
                    <tr key={o.id}>
                      <td><Link href={`/orders/no/${o.order_no}`}>ORD-{o.order_no}</Link></td>
                      <td className="small">{dateShort(o.created_at)}</td>
                      <td className="small">{(o.stage ?? o.status).replace(/_/g, " ")}</td>
                      <td className="num">{money(Number(o.est_subtotal ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>No orders placed in A.I. yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
