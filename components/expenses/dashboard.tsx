"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { BarList, ColumnChart } from "@/components/inventory/charts";
import { Heatmap, SortTable, type Col } from "@/components/expenses/dash";

// The approvers' expense dashboard (expense_kpis in the database does the math). Built to answer: which
// customers cost the most to look after (and is it worth it next to what they buy), who spends the most on
// what, who keeps visiting the same customer, and what's missing a receipt.

export type Kpis = {
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  days: number;
  totals: { spend: number; receipts: number; missing_n: number; missing_amt: number; overdue_n: number; personal: number; card: number; tied: number; meals: number; meals_untied: number; travel: number; people: number; customers: number };
  prev: { spend: number; meals: number; travel: number; missing_n: number };
  categories: { category: string; amount: number; n: number; prev: number }[];
  employees: {
    key: string;
    user_id: string | null;
    name: string;
    branch: string | null;
    job_role: string | null;
    amount: number;
    n: number;
    missing_n: number;
    missing_amt: number;
    overdue_n: number;
    customers: number;
    visit_days: number;
    meals: number;
    travel: number;
    personal: number;
    top_category: string | null;
  }[];
  matrix: { key: string; category: string; amount: number; n: number }[];
  months: { m: string; category: string; amount: number }[];
  branches: { branch: string; amount: number; people: number }[];
  customers: {
    key: string;
    customer: string;
    company_id: string | null;
    amount: number;
    n: number;
    days: number;
    people: number;
    last_day: string;
    travel: number;
    meals: number;
    sales: number | null;
    orders: number | null;
    by: { user_id: string | null; name: string; amount: number; days: number }[];
  }[];
  repeat: { user_id: string; name: string; customer: string; max30: number; days: number; amount: number; travel: number; meals: number; last_day: string }[];
  biggest: { day: string; name: string; vendor: string | null; category: string; customer: string | null; amount: number; receipt_id: string | null; missing: boolean }[];
  vendors: { vendor: string; amount: number; n: number }[];
};

const usd = (v: number | null | undefined) => (v ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const n = (v: number | string | null | undefined) => Number(v ?? 0);
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ROLE: Record<string, string> = { admin: "Admin", crm: "CRM", sales_rep: "Sales", tech: "Tech", warehouse: "Warehouse", accounting: "Accounting" };
const MEALS = ["Meals", "Customer entertainment"];
const TRAVEL = ["Fuel", "Lodging", "Airfare & travel"];

function Delta({ now, before, good = "down" }: { now: number; before: number; good?: "down" | "up" }) {
  if (!before) return <span className="xd-delta">No spend the period before</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return <span className="xd-delta">Same as the period before</span>;
  const bad = good === "down" ? pct > 0 : pct < 0;
  return (
    <span className={`xd-delta ${bad ? "bad" : "good"}`}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}% vs the period before
    </span>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: React.ReactNode; warn?: boolean }) {
  return (
    <div className={`xd-tile${warn ? " warn" : ""}`}>
      <span className="xd-tl">{label}</span>
      <b className="xd-tv">{value}</b>
      <span className="xd-ts">{sub}</span>
    </div>
  );
}

export function ExpenseDashboard({ k, month }: { k: Kpis; /** The month a name opens (the review screen). */ month: string }) {
  const review = (userId: string) => `/admin/expenses/review?u=${userId}&m=${month}`;
  const t = k.totals;
  const tiedPct = t.spend > 0 ? Math.round((n(t.tied) / n(t.spend)) * 100) : 0;
  const cats = k.categories.filter((c) => n(c.amount) > 0);
  const catOrder = cats.map((c) => c.category);

  // Trend: travel vs meals & entertainment, month by month.
  const monthKeys = [...new Set(k.months.map((m) => m.m))].sort();
  const trend = monthKeys.map((m) => {
    const rows = k.months.filter((x) => x.m === m);
    const sum = (list: string[]) => rows.filter((x) => list.includes(x.category)).reduce((a, x) => a + n(x.amount), 0);
    return { label: new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" }), values: [sum(TRAVEL), sum(MEALS)] };
  });
  const totalByMonth = monthKeys.map((m) => ({ label: new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" }), values: [k.months.filter((x) => x.m === m).reduce((a, x) => a + n(x.amount), 0)] }));

  // Person x category.
  const cells: Record<string, Record<string, { amount: number; n: number }>> = {};
  for (const x of k.matrix) (cells[x.key] ??= {})[x.category] = { amount: n(x.amount), n: x.n };
  const heatCats = catOrder.filter((c) => c !== "Returns & credits").slice(0, 9);
  const heatRows = k.employees.filter((e) => n(e.amount) > 0).map((e) => ({ key: e.key, name: e.name, total: n(e.amount), href: e.user_id ? review(e.user_id) : undefined }));

  const custCols: Col<Kpis["customers"][number]>[] = [
    { key: "customer", label: "Customer", get: (r) => r.customer, show: (r) => <span className="xd-name">{r.customer}</span> },
    { key: "amount", label: "Expenses", num: true, get: (r) => n(r.amount), show: (r) => <b>{usd(n(r.amount))}</b> },
    { key: "travel", label: "Travel", num: true, get: (r) => n(r.travel), show: (r) => usd(n(r.travel)) },
    { key: "meals", label: "Meals & ent.", num: true, get: (r) => n(r.meals), show: (r) => usd(n(r.meals)) },
    { key: "days", label: "Visit days", num: true, get: (r) => r.days, title: "Days with an expense tied to this customer" },
    {
      key: "who",
      label: "Who",
      get: (r) => r.by?.[0]?.name ?? "",
      show: (r) => (
        <span className="xd-who">
          {(r.by ?? []).slice(0, 3).map((b) => `${b.name.split(" ")[0]} ${usd(n(b.amount))}`).join(", ")}
          {(r.by ?? []).length > 3 ? ` +${r.by.length - 3}` : ""}
        </span>
      ),
    },
    { key: "sales", label: "Sales", num: true, get: (r) => n(r.sales), show: (r) => (r.company_id ? usd(n(r.sales)) : <span className="faint">Not in list</span>), title: "Orders placed in the same period (invoiced total when there is one)" },
    {
      key: "ratio",
      label: "Cost of sales",
      num: true,
      get: (r) => (n(r.sales) > 0 ? n(r.amount) / n(r.sales) : r.company_id ? 99 : -1),
      show: (r) => (n(r.sales) > 0 ? `${((n(r.amount) / n(r.sales)) * 100).toFixed(n(r.amount) / n(r.sales) < 0.1 ? 1 : 0)}%` : r.company_id ? <span className="err-text">No sales</span> : "—"),
      title: "Expenses as a share of what they bought. High = expensive to look after.",
    },
  ];
  const repCols: Col<Kpis["repeat"][number]>[] = [
    { key: "name", label: "Who", get: (r) => r.name, show: (r) => <Link href={review(r.user_id)}>{r.name}</Link> },
    { key: "customer", label: "Customer", get: (r) => r.customer },
    { key: "max30", label: "Most visits in 30 days", num: true, get: (r) => r.max30, show: (r) => <b>{r.max30}</b> },
    { key: "days", label: "Visit days", num: true, get: (r) => r.days },
    { key: "amount", label: "Spent", num: true, get: (r) => n(r.amount), show: (r) => <b>{usd(n(r.amount))}</b> },
    { key: "travel", label: "Travel", num: true, get: (r) => n(r.travel), show: (r) => usd(n(r.travel)) },
    { key: "meals", label: "Meals & ent.", num: true, get: (r) => n(r.meals), show: (r) => usd(n(r.meals)) },
    { key: "last", label: "Last visit", get: (r) => r.last_day, show: (r) => day(r.last_day) },
  ];
  const empCols: Col<Kpis["employees"][number]>[] = [
    { key: "name", label: "Who", get: (r) => r.name, show: (r) => (r.user_id ? <Link href={review(r.user_id)}>{r.name}</Link> : <span className="warn-text">{r.name}</span>) },
    { key: "branch", label: "Location", get: (r) => r.branch ?? "", show: (r) => `${r.branch ?? ""}${r.job_role ? ` · ${ROLE[r.job_role] ?? r.job_role}` : ""}` },
    { key: "amount", label: "Total", num: true, get: (r) => n(r.amount), show: (r) => <b>{usd(n(r.amount))}</b> },
    { key: "top", label: "Most on", get: (r) => r.top_category ?? "" },
    { key: "travel", label: "Travel", num: true, get: (r) => n(r.travel), show: (r) => usd(n(r.travel)) },
    { key: "meals", label: "Meals & ent.", num: true, get: (r) => n(r.meals), show: (r) => usd(n(r.meals)) },
    { key: "customers", label: "Customers", num: true, get: (r) => r.customers },
    { key: "visits", label: "Visit days", num: true, get: (r) => r.visit_days },
    { key: "missing", label: "No receipt", num: true, get: (r) => r.missing_n, show: (r) => (r.missing_n ? <span className="err-text">{r.missing_n} · {usd(n(r.missing_amt))}</span> : "0") },
  ];
  const bigCols: Col<Kpis["biggest"][number]>[] = [
    { key: "day", label: "Date", get: (r) => r.day, show: (r) => day(r.day) },
    { key: "name", label: "Who", get: (r) => r.name },
    { key: "vendor", label: "Where", get: (r) => r.vendor ?? "", show: (r) => (r.receipt_id ? <a href={`/expenses/file?r=${r.receipt_id}`} target="_blank" rel="noopener noreferrer">{r.vendor}</a> : r.vendor) },
    { key: "category", label: "Category", get: (r) => r.category, show: (r) => (r.missing ? <span className="err-text">No receipt</span> : r.category) },
    { key: "customer", label: "Customer", get: (r) => r.customer ?? "", show: (r) => r.customer ?? <span className="faint">None</span> },
    { key: "amount", label: "Amount", num: true, get: (r) => n(r.amount), show: (r) => <b>{usd(n(r.amount))}</b> },
  ];

  const missingPeople = k.employees.filter((e) => e.missing_n > 0).sort((a, b) => b.missing_n - a.missing_n);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="xd-tiles">
        <Tile label="Total spend" value={usd(n(t.spend))} sub={<Delta now={n(t.spend)} before={n(k.prev.spend)} />} />
        <Tile label="Travel" value={usd(n(t.travel))} sub={<Delta now={n(t.travel)} before={n(k.prev.travel)} />} />
        <Tile label="Meals & entertainment" value={usd(n(t.meals))} sub={<Delta now={n(t.meals)} before={n(k.prev.meals)} />} />
        <Tile label="Tied to a customer" value={`${tiedPct}%`} sub={`${t.customers} ${t.customers === 1 ? "customer" : "customers"} · ${usd(n(t.tied))}`} />
        <Tile label="Guest meals, no customer" value={usd(n(t.meals_untied))} sub="Meals with guests or entertainment, no customer picked" warn={n(t.meals_untied) > 0} />
        <Tile label="No receipt" value={String(t.missing_n)} sub={`${usd(n(t.missing_amt))}${t.overdue_n ? ` · ${t.overdue_n} over 30 days old` : ""}`} warn={t.missing_n > 0} />
      </div>

      <div className="hub-grid">
        <section className="card col hub-card">
          <b>Spend by category</b>
          <BarList
            caption="Spend by category"
            rows={cats.map((c) => ({ label: c.category, value: n(c.amount), note: `${c.n} ${c.n === 1 ? "line" : "lines"} · the period before: ${usd(n(c.prev))}` }))}
          />
        </section>
        <section className="card col hub-card">
          <b>Travel and meals, month by month</b>
          <ColumnChart
            caption="Travel and meals and entertainment by month"
            rows={trend}
            series={[
              { key: "travel", label: "Travel (fuel, hotels, flights)" },
              { key: "meals", label: "Meals & entertainment" },
            ]}
          />
        </section>

        <section className="card col hub-card wide">
          <div className="col" style={{ gap: 2 }}>
            <b>Customers that cost the most to look after</b>
            <span className="small muted">Every receipt tied to a customer, next to what that customer bought in the same dates. Tap a column to sort; highlighted rows cost more than 5% of their sales.</span>
          </div>
          <SortTable
            rows={k.customers}
            cols={custCols}
            start="amount"
            hl={(r) => (n(r.sales) > 0 ? n(r.amount) / n(r.sales) > 0.05 : Boolean(r.company_id) && n(r.amount) > 250)}
            empty="No receipts tied to a customer in these dates."
          />
        </section>

        <section className="card col hub-card wide">
          <div className="col" style={{ gap: 2 }}>
            <b>Same customer, over and over</b>
            <span className="small muted">Anyone with expenses at one customer on 3 or more different days within 30 days. Highlighted: 5 or more.</span>
          </div>
          <SortTable rows={k.repeat} cols={repCols} start="max30" hl={(r) => r.max30 >= 5} empty="Nobody visited the same customer 3 or more times in 30 days." />
        </section>

        <section className="card col hub-card wide">
          <div className="col" style={{ gap: 2 }}>
            <b>Who spends the most on what</b>
            <span className="small muted">Darker = more. Tap a name to see their month.</span>
          </div>
          {heatRows.length ? <Heatmap rows={heatRows} cats={heatCats} cells={cells} /> : <span className="small muted">No spend in these dates.</span>}
        </section>

        <section className="card col hub-card wide">
          <b>Everyone</b>
          <SortTable rows={k.employees} cols={empCols} start="amount" hl={(r) => r.overdue_n > 0} empty="No spend in these dates." />
        </section>

        <section className="card col hub-card">
          <b>Total spend by month</b>
          <ColumnChart caption="Total spend by month" rows={totalByMonth} series={[{ key: "all", label: "Total" }]} />
        </section>
        <section className="card col hub-card">
          <b>By location</b>
          <BarList caption="Spend by location" rows={k.branches.map((b) => ({ label: b.branch, value: n(b.amount), note: `${b.people} ${b.people === 1 ? "person" : "people"}` }))} />
        </section>

        <section className="card col hub-card">
          <b>Where the money goes</b>
          <BarList caption="Top places" rows={k.vendors.map((v) => ({ label: v.vendor, value: n(v.amount), note: `${v.n} ${v.n === 1 ? "time" : "times"}` }))} />
        </section>
        <section className="card col hub-card">
          <b>Missing receipts</b>
          {missingPeople.length ? (
            <div className="hub-rows">
              {missingPeople.map((e) => (
                <div key={e.key} className={`hub-row${e.overdue_n ? " err" : ""}`}>
                  {e.overdue_n ? <CircleAlert size={14} style={{ flex: "none" }} /> : null}
                  <span className="grow ellipsis">{e.user_id ? <Link href={review(e.user_id)}>{e.name}</Link> : e.name}</span>
                  <span className="v">
                    {e.missing_n} · {usd(n(e.missing_amt))}
                    {e.overdue_n ? ` · ${e.overdue_n} over 30 days` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="small muted">Every card charge in these dates has a receipt.</span>
          )}
        </section>

        <section className="card col hub-card wide">
          <b>Biggest single expenses</b>
          <SortTable rows={k.biggest} cols={bigCols} start="amount" hl={(r) => r.missing} empty="Nothing in these dates." limit={12} />
        </section>
      </div>
    </div>
  );
}
