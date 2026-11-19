import Link from "next/link";
import { orderBoardCounts } from "@/lib/chat";
import { OrderChatButton } from "@/components/chat/order-button";
import { ChevronDown, ChevronLeft, ChevronRight, Clock, ClipboardList, Globe, OctagonAlert, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { can, seesOrders } from "@/lib/access";
import { STAGES, addDays, centralStart, deskAccess, stageOf, waitingSince } from "@/lib/order-desk";
import { monthDay, money, orderNo, searchSafe } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { duration } from "@/lib/desk-stats";
import { ApprovalPill, Empty, StatusPill } from "@/components/ui";
import { MoreMenu } from "@/components/order2/menu";
import type { Branch, Order, OrderStage } from "@/lib/types";

export const metadata = { title: "Orders" };

const FILTERS = [
  ["all", "All"],
  ["open", "Open"],
  ["approval", "Needs approval"],
  ["mine", "Mine"],
  ["completed", "Completed"],
] as const;

// The stage pills in the new style.
const PILL2: Record<string, string> = { "pill warn": "pill2 warn sm", "pill ok": "pill2 ok sm", pill: "pill2 sm", "pill grey": "pill2 sm" };

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
  const { data: branchRows } = await supabase.from("branches").select("id, name").order("sort");
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
  if (filter === "open") query = query.not("stage", "in", "(completed,cancelled)");
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
  const when = day
    ? `${done ? "Done" : "Placed"} ${md(day)}`
    : week
      ? `${done ? "Done" : "Placed"} the week of ${md(week)}`
      : from || to
        ? `${done ? "Picked up or shipped out" : "Placed"} ${from ? md(from) : "…"} – ${to ? md(to) : "today"}`
        : null;
  const what = stuck
    ? "Waiting over a day"
    : stages.length
      ? stages.map((s) => STAGES[s].short).join(", ")
      : open
        ? "Open orders"
        : done && !when
          ? "Picked up or shipped out"
          : null;
  const keepDesk = sp.from_desk === "1";
  const clearHref = `/orders${filter !== "all" && access !== "mine" ? `?status=${filter}` : ""}`;
  const chatCounts = emp ? await orderBoardCounts(supabase, orders.map((o) => o.id)) : new Map<string, number>();
  const deskBack = emp && access ? "/orders/desk" : "/";
  // Jeremiah (the order keepers) sees the deleted orders log, with how many are waiting there.
  const keeper = emp ? Boolean((await supabase.rpc("is_order_keeper")).data) : false;
  const deletedCount = keeper
    ? ((await supabase.from("orders_deleted").select("id", { count: "exact", head: true }).is("restored_at", null)).count ?? 0)
    : 0;

  // The header line: how many are open, and how many were placed in the last 30 days.
  const headCount = (open: boolean) => {
    let c = supabase.from("orders").select("id", { count: "exact", head: true });
    if (emp && access === "mine") c = c.or(`placed_by.eq.${profile.id},sales_rep_id.eq.${profile.id}`);
    return open ? c.not("stage", "in", "(completed,cancelled)") : c.gte("created_at", centralStart(addDays(today, -30)));
  };
  const [{ count: openN }, { count: monthN }, webRes] = await Promise.all([
    headCount(true),
    headCount(false),
    emp ? supabase.from("adc_orders").select("id", { count: "exact", head: true }).eq("status", "new") : Promise.resolve({ count: 0, error: null }),
  ]);
  const webNew = webRes.error ? 0 : (webRes.count ?? 0);

  const href = (o: { status?: string; b?: string | null }) => {
    const u = new URLSearchParams();
    const st = o.status ?? (filter !== "all" && access !== "mine" ? filter : "");
    if (st && st !== "all") u.set("status", st);
    const bb = o.b === undefined ? branch : o.b;
    if (bb) u.set("b", bb);
    if (q) u.set("q", q);
    const x = u.toString();
    return `/orders${x ? `?${x}` : ""}`;
  };
  const shortB = (id: string | null) => (id ? (branchList.find((b) => b.id === id)?.name ?? "").replace(/,\s*[A-Z]{2}$/, "") : "");
  const where = (o: Order) => {
    const d = o.scheduled_for ? ` ${monthDay(o.scheduled_for)}` : "";
    if (o.delivery_method === "dropship") return `Drop ship${d}`;
    const place = shortB(o.branch_id);
    return `${o.delivery_method === "pickup" ? "Pickup" : "Delivery"}${d}${place ? ` · ${place}` : ""}`;
  };
  const grouped = filter === "all" && !filtered && !q && access !== "mine";
  const isDone = (o: Order) => ["completed", "cancelled"].includes(stageOf(o) ?? o.status);
  const groups = grouped
    ? [
        { key: "open", title: "Open", rows: orders.filter((o) => !isDone(o)) },
        { key: "done", title: "Completed", rows: orders.filter(isDone) },
      ].filter((g) => g.rows.length)
    : [{ key: "all", title: "", rows: orders }];

  const row = (o: Order) => {
    const st = stageOf(o);
    const w = since.get(o.id) ?? (st && !isDone(o) ? waitingSince({ ...o, stage: st }, today) : null);
    const hours = w ? (Date.now() - new Date(w).getTime()) / 3600_000 : 0;
    const late = st === "scheduled" && Boolean(since.get(o.id));
    const kind = (o as { kind?: string }).kind;
    const total = Number(o.est_subtotal) > 0 ? `${money(o.est_subtotal)}${o.has_customer_pricing ? " +" : ""}` : o.has_customer_pricing ? "Customer pricing" : "";
    return (
      <Link key={o.id} href={`/orders/${o.id}`} className={`ord-row${isDone(o) ? " done" : ""}`}>
        <span className="ord-no">
          <b>{orderNo(o.order_no)}</b>
          <span>{monthDay(o.created_at)}</span>
        </span>
        <span className="ord-cust">
          <b>{emp ? o.company_name : o.placed_by_name}</b>
          <span>
            {[emp ? o.account_no : null, kind === "return" ? "Return" : kind === "exchange" ? "Exchange" : null, o.po_number ? `PO ${o.po_number}` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="ord-st">
          {emp && st ? (
            isDone(o) ? (
              <span className="ord-done">{st === "completed" ? <span className="dot" aria-hidden="true" /> : null}{st === "completed" && o.completed_at ? `${o.delivery_method === "pickup" ? "Picked up" : "Done"} ${monthDay(o.completed_at)}` : STAGES[st].short}</span>
            ) : (
              <span className={PILL2[STAGES[st].pill] ?? "pill2 sm"}>{STAGES[st].short}</span>
            )
          ) : (
            <span className="row" style={{ gap: 6 }}><ApprovalPill order={o} /><StatusPill status={o.status} /></span>
          )}
          {emp && o.pay_waiting_at && o.credit_status !== "approved" ? <span className="ord-wait warn">Waiting on payment</span> : null}
          {emp && w && (hours >= 24 || late) ? (
            <span className={`ord-wait ${late || hours >= 72 ? "crit" : "warn"}`}>
              {late || hours >= 72 ? <OctagonAlert size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
              {late ? `Past its ${o.delivery_method === "pickup" ? "pickup" : "delivery"} date` : `Waiting ${duration(hours)}`}
            </span>
          ) : null}
        </span>
        <span className="ord-where">{where(o)}</span>
        <span className="ord-total">{total ? (total === "Customer pricing" ? <span className="faint">{total}</span> : <b>{total}</b>) : <span className="faint">-</span>}</span>
        <span className="ord-chat">{emp ? <OrderChatButton orderId={o.id} count={chatCounts.get(o.id) ?? 0} /> : <ChevronRight size={18} className="chev" />}</span>
      </Link>
    );
  };

  return (
    <main className="shell wide">
      <div className="o2 ord">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href={keepDesk || emp ? deskBack : "/"} className="o2-back" aria-label="Back"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>{emp && access !== "mine" ? "Orders" : "My orders"}</h1>
              <span className="o2-sub">{openN ?? 0} open · {monthN ?? 0} placed in the last 30 days</span>
            </div>
          </div>
          <div className="o2-head-r">
            {!emp || can(profile, "ordering") ? <Link href="/order" className="b2 sm"><Plus size={17} /> New order</Link> : null}
            {emp && webNew && access ? <Link href="/orders/web" className="b2 quiet sm"><Globe size={16} /> {webNew} web {webNew === 1 ? "order" : "orders"}</Link> : null}
            {emp && (access || keeper) ? (
              <MoreMenu label="More: order desk, return or exchange, deleted orders">
                {access ? <Link className="menu2-i" href="/orders/desk"><ClipboardList size={18} /> Order desk</Link> : null}
                {access && (can(profile, "ordering") || can(profile, "order_desk")) ? <Link className="menu2-i" href="/orders/return"><RotateCcw size={18} /> Return or exchange</Link> : null}
                {access && (profile.role === "admin" || can(profile, "order_desk") || can(profile, "ordering")) ? <Link className="menu2-i" href="/orders/web"><Globe size={18} /> ADC web orders{webNew ? ` · ${webNew} new` : ""}</Link> : null}
                {keeper ? <Link className="menu2-i" href="/orders/deleted"><Trash2 size={18} /> Deleted orders{deletedCount ? ` · ${deletedCount}` : ""}</Link> : null}
              </MoreMenu>
            ) : null}
          </div>
        </div>

        {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}

        {emp ? (
          <div className="stk-bar">
            <form className="stk-search" action="/orders" role="search">
              <Search size={18} aria-hidden="true" />
              {filter !== "all" && access !== "mine" ? <input type="hidden" name="status" value={filter} /> : null}
              {branch ? <input type="hidden" name="b" value={branch} /> : null}
              <input type="search" name="q" defaultValue={q} placeholder="Customer, ORD #, PO, Sales Order # or invoice #" aria-label="Search orders" />
            </form>
            {access !== "mine" ? (
              <nav className="seg2" aria-label="Show">
                {FILTERS.map(([id, label]) => (
                  <Link key={id} href={href({ status: id })} className={filter === id && !filtered ? "on" : undefined} aria-current={filter === id && !filtered ? "page" : undefined}>{label}</Link>
                ))}
              </nav>
            ) : null}
            {branchList.length > 1 ? (
              <MoreMenu
                label="Pick a location"
                triggerClass="stk-select ord-loc"
                trigger={<><span>Location</span><b>{branch === "dropship" ? "Drop ship" : shortB(branch) || "All"}</b><ChevronDown size={16} aria-hidden="true" /></>}
              >
                <Link className="menu2-i" href={href({ b: null })}>All locations</Link>
                {branchList.map((b) => <Link key={b.id} className="menu2-i" href={href({ b: b.id })}>{b.name}</Link>)}
                <Link className="menu2-i" href={href({ b: "dropship" })}>Drop ship</Link>
              </MoreMenu>
            ) : null}
          </div>
        ) : null}

        {filtered && (what || when) ? (
          <div className="ord-filter" role="status">
            <span className="grow">
              <b>{[what, when].filter(Boolean).join(" · ")}</b>
              <span className="faint"> · {orders.length === 200 ? "first 200" : `${orders.length} ${orders.length === 1 ? "order" : "orders"}`}</span>
            </span>
            <Link href={clearHref} className="b2 quiet sm" aria-label="Clear the filter"><X size={15} /> Clear</Link>
          </div>
        ) : null}

        {orders.length === 0 ? (
          <Empty icon="cart" title={filtered || q ? "No orders match" : "No orders yet"}>
            {filtered || q ? <Link href={clearHref}>See all orders</Link> : emp ? "Orders placed in AMBIT Intelligence show up here." : <Link href="/order">Place your first order</Link>}
          </Empty>
        ) : (
          <div className="card2 ord-list">
            <div className="ord-row ord-cols" aria-hidden="true">
              <span>Order</span><span>Customer</span><span>Where it is</span><span>Pickup or delivery</span><span className="ord-total">Total</span><span className="ord-chat">{emp ? "Chat" : ""}</span>
            </div>
            {groups.map((g) => (
              <div key={g.key}>
                {g.title ? <div className="ord-grp">{g.title} · {g.rows.length}</div> : null}
                {g.rows.map(row)}
              </div>
            ))}
            {orders.length >= 200 ? <div className="ord-more">Showing the newest 200. Search to find an older order.</div> : null}
          </div>
        )}
      </div>
    </main>
  );
}
