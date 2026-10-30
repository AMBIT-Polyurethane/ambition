import Link from "next/link";
import { ChevronRight, Clock, OctagonAlert, X } from "lucide-react";
import { redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { seesOrders } from "@/lib/access";
import { STAGES, addDays, centralStart, deskAccess, stageOf, waitingSince } from "@/lib/order-desk";
import { dateShort, money, orderNo, searchSafe } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { duration } from "@/lib/desk-stats";
import { ApprovalPill, Empty, StatusPill, TopBar } from "@/components/ui";
import type { Branch, Order, OrderStage } from "@/lib/types";

export const metadata = { title: "Orders" };

const FILTERS = [
  ["all", "All"],
  ["new", "New"],
  ["approval", "Needs approval"],
  ["processing", "Processing"],
  ["completed", "Completed"],
  ["mine", "Mine"],
] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ALL_STAGES = Object.keys(STAGES) as OrderStage[];
const md = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Every order the person can see, newest first, with search and quick filters. The Order Desk dashboard opens it
 * already filtered (a day's orders, one status, one location, the ones waiting over a day, ...).
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  if (!seesOrders(profile)) redirect("/");
  const access = deskAccess(profile);
  // Sales reps see the orders they placed.
  const filter = access === "mine" ? "mine" : sp.status ?? "all";
  const q = searchSafe(sp.q);
  const today = todayCentral();

  // ---- filters from the dashboard
  const stages = (sp.stage ?? "").split(",").filter((s): s is OrderStage => ALL_STAGES.includes(s as OrderStage));
  const open = sp.open === "1";
  const stuck = sp.stuck === "1";
  const done = sp.done === "1";
  const day = sp.day && DAY.test(sp.day) ? sp.day : null;
  const week = sp.week && DAY.test(sp.week) ? sp.week : null;
  const from = day ?? week ?? (sp.from && DAY.test(sp.from) ? sp.from : null);
  const to = day ?? (week ? addDays(week, 6) : sp.to && DAY.test(sp.to) ? sp.to : null);
  const { data: branchRows } = emp ? await supabase.from("branches").select("id, name").order("sort") : { data: [] };
  const branchList = (branchRows ?? []) as Pick<Branch, "id" | "name">[];
  const branch = sp.b === "dropship" || branchList.some((b) => b.id === sp.b) ? sp.b! : null;
  const filtered = Boolean(stages.length || open || stuck || done || from || to || branch);

  let query = supabase
    .from("orders")
    .select("*") // includes the approval columns when the database has them
    .order(done ? "completed_at" : "created_at", { ascending: false })
    .limit(stuck ? 500 : 200);
  if (["new", "processing", "completed", "cancelled"].includes(filter)) query = query.eq("status", filter);
  // "Mine": orders you placed, and your customers' orders (you're their sales rep).
  if (filter === "mine") query = query.or(`placed_by.eq.${profile.id},sales_rep_id.eq.${profile.id}`);
  if (filter === "approval") query = query.in("approval_status", ["pending", "changes_requested"]).neq("status", "cancelled");
  if (stages.length) query = query.in("stage", stages);
  if (open || stuck) query = query.not("stage", "in", "(completed,cancelled)");
  if (branch === "dropship") query = query.is("branch_id", null);
  else if (branch) query = query.eq("branch_id", branch);
  const col = done ? "completed_at" : "created_at";
  if (done) query = query.eq("status", "completed");
  if (from) query = query.gte(col, centralStart(from));
  if (to) query = query.lt(col, centralStart(addDays(to, 1)));
  if (q) {
    const n = Number(q.replace(/\D/g, ""));
    query = n
      ? query.or(`order_no.eq.${n},po_number.ilike.%${q}%,ambit_po.ilike.%${q}%,invoice_no.ilike.%${q}%`)
      : query.or(`company_name.ilike.%${q}%,po_number.ilike.%${q}%,ambit_po.ilike.%${q}%,invoice_no.ilike.%${q}%`);
  }
  const { data } = await query;
  let orders = (data ?? []) as Order[];

  // Waiting over a day (or past the pickup / delivery date): oldest first.
  const since = new Map<string, string>();
  if (stuck) {
    const dayAgo = Date.now() - 24 * 3600_000;
    for (const o of orders) {
      const w = waitingSince({ ...o, stage: stageOf(o) }, today);
      if (w && (stageOf(o) === "scheduled" || new Date(w).getTime() < dayAgo)) since.set(o.id, w);
    }
    orders = orders.filter((o) => since.has(o.id)).sort((a, b) => since.get(a.id)!.localeCompare(since.get(b.id)!));
  }

  // ---- what the filter says, in words
  const branchName = branch === "dropship" ? "Drop ship" : branchList.find((b) => b.id === branch)?.name ?? null;
  const when = day
    ? `${done ? "Done" : "Placed"} ${md(day)}`
    : week
      ? `${done ? "Done" : "Placed"} the week of ${md(week)}`
      : from || to
        ? `${done ? "Picked up or delivered" : "Placed"} ${from ? md(from) : "…"} – ${to ? md(to) : "today"}`
        : null;
  const what = stuck
    ? "Waiting over a day"
    : stages.length
      ? stages.map((s) => STAGES[s].short).join(", ")
      : open
        ? "Open orders"
        : done && !when
          ? "Picked up or delivered"
          : null;
  const summary = [what, when, branchName].filter(Boolean).join(" · ");
  const keepDesk = sp.from_desk === "1";
  const clearHref = `/orders${filter !== "all" && access !== "mine" ? `?status=${filter}` : ""}`;
  const chipHref = (id: string) => {
    const u = new URLSearchParams();
    u.set("status", id);
    if (q) u.set("q", q);
    return `/orders?${u.toString()}`;
  };
  const deskBack = emp && access ? "/orders/desk" : "/";
  // Jeremiah (the order keepers) sees the deleted orders log, with how many are waiting there.
  const keeper = emp ? Boolean((await supabase.rpc("is_order_keeper")).data) : false;
  const deletedCount = keeper
    ? ((await supabase.from("orders_deleted").select("id", { count: "exact", head: true }).is("restored_at", null)).count ?? 0)
    : 0;

  return (
    <main className="shell">
      <TopBar
        title={emp ? (access === "mine" ? "My orders" : "Orders") : "My orders"}
        back={keepDesk || emp ? deskBack : "/"}
        right={
          emp && (access || keeper) ? (
            <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
              {keeper ? <Link href="/orders/deleted" className="btn sm">Deleted orders{deletedCount ? ` (${deletedCount})` : ""}</Link> : null}
              {access ? <Link href="/orders/desk" className="btn sm dark">Order desk</Link> : null}
            </span>
          ) : null
        }
      />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {emp ? (
        <>
          <form className="search" action="/orders">
            <input type="hidden" name="status" value={filter} />
            <input className="input" name="q" defaultValue={q} placeholder="Search customer, order #, PO, Sales Order # or Invoice #" aria-label="Search orders" style={{ paddingLeft: 16 }} />
          </form>
          {access !== "mine" ? (
            <div className="chips">
              {FILTERS.map(([id, label]) => (
                <Link key={id} href={chipHref(id)} className={`chip${filter === id && !filtered ? " on" : ""}`}>{label}</Link>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {filtered ? (
        <div className="filter-bar" role="status">
          <span className="grow">
            <b>{summary || "Filtered"}</b>
            <span className="faint"> · {orders.length === 200 ? "first 200" : `${orders.length} ${orders.length === 1 ? "order" : "orders"}`}</span>
          </span>
          <Link href={clearHref} className="linkbtn small" aria-label="Clear the filter">
            <X size={15} /> Clear
          </Link>
        </div>
      ) : null}

      {orders.length === 0 ? (
        <Empty icon="cart" title={filtered ? "No orders match" : "No orders yet"}>
          {filtered ? <Link href={clearHref}>See all orders</Link> : emp ? "Orders placed in AMBIT Intelligence show up here." : <Link href="/order">Place your first order</Link>}
        </Empty>
      ) : (
        <div className="list">
          {orders.map((o) => {
            const w = since.get(o.id);
            const hours = w ? (Date.now() - new Date(w).getTime()) / 3600_000 : 0;
            const late = stageOf(o) === "scheduled";
            return (
              <Link key={o.id} href={`/orders/${o.id}`} className="item">
                <div className="grow">
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="t">{orderNo(o.order_no)}</span>
                    <span className="row" style={{ gap: 6 }}>
                      {emp && stageOf(o) ? (
                        <span className={STAGES[stageOf(o)!].pill}>{STAGES[stageOf(o)!].short}</span>
                      ) : (
                        <>
                          <ApprovalPill order={o} />
                          <StatusPill status={o.status} />
                        </>
                      )}
                    </span>
                  </div>
                  <div className="s ellipsis">
                    {emp ? `${o.company_name}${o.account_no ? ` · ${o.account_no}` : ""}` : o.placed_by_name}
                    {o.po_number ? ` · PO ${o.po_number}` : ""}
                  </div>
                  <div className="tiny faint">
                    {done && o.completed_at ? `Done ${dateShort(o.completed_at)} · placed ${dateShort(o.created_at)}` : dateShort(o.created_at)}
                    {Number(o.est_subtotal) > 0 ? ` · ${money(o.est_subtotal)}${o.has_customer_pricing ? " + customer-priced items" : ""}` : o.has_customer_pricing ? " · Customer pricing" : ""}
                  </div>
                  {w ? (
                    <div className={`wait-tag ${late || hours >= 72 ? "crit" : "warn"}`}>
                      {late || hours >= 72 ? <OctagonAlert size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
                      {late ? `Past its ${o.delivery_method === "pickup" ? "pickup" : "delivery"} date (${dateShort(o.scheduled_for)})` : `Waiting ${duration(hours)}`}
                    </div>
                  ) : null}
                </div>
                <ChevronRight size={18} className="chev" />
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
