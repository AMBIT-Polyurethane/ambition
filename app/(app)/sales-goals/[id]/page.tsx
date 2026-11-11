import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Clock, Target } from "lucide-react";
import { requireActive } from "@/lib/session";
import { dateShort, money, orderNo } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { salesRange } from "@/lib/sales-range";
import { teamOf, type GoalPerson } from "@/lib/sales-goals";
import { goalBoard, personSales } from "@/lib/sales-goals-server";
import { Empty, TopBar } from "@/components/ui";
import { RangeFilter } from "@/components/range-filter";

export const metadata = { title: "Sales" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOW = 300; // rows shown before "Show all"

/**
 * One person's sales, newest first: customer, date of sale and the sale's total, with a date filter. A sales rep's
 * sales are their customers' orders; a warehouse manager's (or CRM's) are every order from their location: the same
 * orders the Sales goals tracker counts. Admins can open anyone's; everyone else only their own.
 */
export default async function PersonSalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { supabase, profile } = await requireActive();
  const admin = profile.role === "admin";
  if (!admin && profile.role !== "employee") redirect("/");
  if (!UUID.test(id)) notFound();
  if (!admin && id !== profile.id) redirect(`/sales-goals/${profile.id}`);

  // Who, and how they're measured (from the goal board, so the list always matches the tracker).
  const board = await goalBoard(supabase, null, id);
  let person: Pick<GoalPerson, "id" | "name" | "job_role" | "branch_id" | "basis"> | undefined = board?.people.find((p) => p.id === id);
  if (!person) {
    const { data } = await supabase.from("profiles").select("id, full_name, email, job_role, branch_id, role").eq("id", id).maybeSingle();
    const p = data as { id: string; full_name: string | null; email: string; job_role: string | null; branch_id: string | null; role: string } | null;
    if (!p || (p.role !== "employee" && p.role !== "admin")) notFound();
    person = { id: p.id, name: p.full_name?.trim() || p.email, job_role: p.job_role, branch_id: p.branch_id, basis: p.job_role === "warehouse" ? "branch" : "rep" };
  }

  const today = todayCentral();
  const range = salesRange(sp, today);
  const base = `/sales-goals/${id}`;
  const [{ rows, capped, error }, { data: branchRows }] = await Promise.all([
    personSales(supabase, person, range.from, range.to),
    supabase.from("branches").select("id, name"),
  ]);
  const branchName = new Map(((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const place = person.branch_id ? branchName.get(person.branch_id) ?? person.branch_id.toUpperCase() : null;

  const total = rows.reduce((a, r) => a + r.total, 0);
  const waiting = rows.filter((r) => r.waiting).length;
  const all = sp.all === "1";
  const shown = all ? rows : rows.slice(0, SHOW);
  const keep = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "all" && v) as [string, string][]);
  keep.set("all", "1");

  const team = teamOf(person);
  const who =
    person.basis === "branch"
      ? place
        ? `${team === "sales" ? "Sales rep" : "Warehouse"} · every order from ${place}`
        : "No location set (Admin → Accounts), so no orders count yet"
      : `Sales rep · their customers' orders`;

  return (
    <main className="shell sales-page">
      <TopBar
        title={admin ? person.name : "Your sales"}
        back={admin ? `/sales-goals?t=${team}` : "/sales-goals"}
        right={
          <Link href={admin ? `/sales-goals?p=${id}` : "/sales-goals"} className="btn sm dark" style={{ marginLeft: "auto" }}>
            <Target size={15} aria-hidden="true" /> Goals
          </Link>
        }
      />

      <div className="sales-bar">
        <span className="small muted grow">{who}</span>
        <RangeFilter base={base} current={range.key} label={range.label} from={range.from} to={range.to} today={today} />
      </div>

      <section className="card sales-sum" aria-label="Totals">
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="tiny faint up">Total sales · {range.label}</span>
          <b className="sales-big">{money(total)}</b>
        </div>
        <div className="sales-facts">
          <span><b>{rows.length.toLocaleString("en-US")}</b> {rows.length === 1 ? "sale" : "sales"}</span>
          {rows.length ? <span>Average <b>{money(total / rows.length)}</b></span> : null}
        </div>
      </section>

      {error ? <div className="alert err small" role="alert">Couldn&apos;t load the sales: {error}</div> : null}
      {waiting ? (
        <div className="alert warn small" role="status">
          <Clock size={16} style={{ flex: "none" }} aria-hidden="true" />
          <span>
            {waiting} {waiting === 1 ? "sale is" : "sales are"} waiting for the order desk to enter invoice prices; the totals include only the
            lines priced so far.
          </span>
        </div>
      ) : null}
      {capped ? <div className="alert info small">Showing the newest {rows.length.toLocaleString("en-US")} sales. Pick shorter dates to see the rest.</div> : null}

      {rows.length === 0 && !error ? (
        <Empty icon="cart" title="No sales in these dates">
          {range.key !== "all" ? <Link href={`${base}?r=all`}>See all time</Link> : "Orders credited to this person show up here."}
        </Empty>
      ) : (
        <div className="sales-list" role="table" aria-label={`Sales, ${range.label}`}>
          <div className="sl-head" role="row">
            <span role="columnheader">Customer</span>
            <span role="columnheader">Date of sale</span>
            <span role="columnheader" className="num">Total</span>
          </div>
          {shown.map((r) => (
            <Link key={r.id} href={`/orders/${r.id}`} className="sl-row" role="row">
              <span className="sl-cust" role="cell">
                <b className="ellipsis">{r.company_name}</b>
                <span className="tiny faint">
                  {orderNo(r.order_no)}
                  {person.basis === "rep" && r.branch_id ? ` · ${(branchName.get(r.branch_id) ?? r.branch_id).toString()}` : ""}
                </span>
              </span>
              <span className="sl-date" role="cell">{dateShort(r.placed_at)}</span>
              <span className="sl-total num" role="cell">
                {money(r.total)}
                {r.waiting ? <span className="pill warn">Prices pending</span> : null}
              </span>
              <ChevronRight size={16} className="sl-go" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
      {!all && rows.length > SHOW ? (
        <Link href={`${base}?${keep.toString()}`} className="btn sm" style={{ alignSelf: "center" }}>
          Show all {rows.length.toLocaleString("en-US")} sales
        </Link>
      ) : null}

      <p className="tiny faint" style={{ margin: 0 }}>
        A sale counts on the day the order was placed (Central time), at the invoice prices the order desk enters. Cancelled orders don&apos;t
        count. Tap a sale to open the order.
      </p>
    </main>
  );
}
