import Link from "next/link";
import { orderBoardCounts } from "@/lib/chat";
import { OrderChatButton } from "@/components/chat/order-button";
import { ChevronDown, ChevronLeft, Clock, List, OctagonAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { monthDay, orderNo } from "@/lib/format";
import { STAGES, deskAccess, waitingSince } from "@/lib/order-desk";
import { todayCentral } from "@/lib/sale";
import { duration } from "@/lib/desk-stats";
import { Help } from "@/components/help";
import { MoreMenu } from "@/components/order2/menu";
import { DeskDashboard } from "@/components/desk-dashboard";
import { RANGES, type DeskStats, type RangeKey } from "@/lib/desk-stats";
import type { Branch, Order, OrderStage } from "@/lib/types";

export const metadata = { title: "Order desk" };
export const dynamic = "force-dynamic";

type Tab = { stage: OrderStage; who: "desk" | "credit" | "both" };

// Each queue, and who works it. CRM = order desk box, Accounting = credit check box.
const TABS: Tab[] = [
  { stage: "needs_po", who: "desk" },
  { stage: "invoice_update", who: "desk" },
  { stage: "credit", who: "credit" },
  { stage: "schedule", who: "desk" },
  { stage: "hold", who: "both" },
  { stage: "scheduled", who: "both" },
  { stage: "customer", who: "desk" },
  { stage: "completed", who: "both" },
];

// The board: one column per step, left to right, and whose job it is.
const BOARD: { stage: OrderStage; who: string }[] = [
  { stage: "customer", who: "Sales rep follows up" },
  { stage: "needs_po", who: "Order desk" },
  { stage: "invoice_update", who: "Order desk" },
  { stage: "credit", who: "Accounting" },
  { stage: "hold", who: "Desk + sales rep" },
  { stage: "schedule", who: "Order desk" },
  { stage: "scheduled", who: "Warehouse" },
];
const PER_COL = 8;

export default async function OrderDeskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  // One Order Desk for all staff: everyone who works orders sees all of them; sales reps see the ones they placed and their customers' orders.
  const access = deskAccess(profile);
  if (!access) redirect("/");
  const mine = access === "mine";
  const desk = can(profile, "order_desk");
  const credit = can(profile, "credit_check");
  const tabs = mine || (!desk && !credit) ? TABS : TABS.filter((t) => t.who === "both" || (t.who === "desk" ? desk : credit));

  // Filters at the top scope the dashboard and the lists below: time range and location.
  const range = (RANGES.find((r) => r.key === sp.r)?.key ?? "30") as RangeKey;
  const { data: branchRows } = await supabase.from("branches").select("id, name, state, sort").order("sort");
  const branchList = ((branchRows ?? []) as (Branch & { sort: number })[]);
  const branchId = sp.b === "dropship" || branchList.some((b) => b.id === sp.b) ? sp.b! : null;
  const days = RANGES.find((r) => r.key === range)!.days;
  const { data: statsData, error: statsError } = await supabase.rpc("order_desk_stats", { p_days: days, p_branch: branchId });
  const stats = statsError ? null : (statsData as DeskStats);
  const since = stats?.since ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  // A Supabase query narrowed to the chosen location.
  const where = <T,>(q: T): T => {
    const b = q as unknown as { eq: (c: string, v: string) => unknown; is: (c: string, v: null) => unknown };
    const scoped = (branchId === "dropship" ? b.is("branch_id", null) : branchId ? b.eq("branch_id", branchId) : q) as T;
    return (mine ? (scoped as unknown as { or: (f: string) => unknown }).or(`placed_by.eq.${profile.id},sales_rep_id.eq.${profile.id}`) : scoped) as T;
  };

  // Every open order (one query), sorted into its step. Oldest waiting first; scheduled ones by date.
  const { data: openData, error: openError } = await where(
    supabase.from("orders").select("*").not("stage", "in", "(completed,cancelled)").order("created_at", { ascending: true }).limit(600),
  );
  const setupMissing = Boolean(openError);
  const openOrders = (openData ?? []) as Order[];
  const today = todayCentral();
  const branches = new Map(branchList.map((b) => [b.id, b]));
  const chatCounts = await orderBoardCounts(supabase, openOrders.map((o) => o.id));
  const shortB = (id: string | null) => (id ? (branches.get(id)?.name ?? "").replace(/,\s*[A-Z]{2}$/, "") : "");
  const whereTo = (o: Order) => {
    const d = o.scheduled_for ? ` ${monthDay(o.scheduled_for)}` : "";
    if (o.delivery_method === "dropship") return `Drop ship${d}`;
    return `${o.delivery_method === "pickup" ? "Pickup" : "Delivery"}${d}${shortB(o.branch_id) ? ` · ${shortB(o.branch_id)}` : ""}`;
  };
  const cols = BOARD.map((c) => {
    let rows = openOrders.filter((o) => o.stage === c.stage);
    if (c.stage === "scheduled") rows = [...rows].sort((x, y) => (x.scheduled_for ?? "").localeCompare(y.scheduled_for ?? ""));
    return { ...c, rows };
  });
  const keep = (p: { r?: string; b?: string | null }) => {
    const q = new URLSearchParams();
    const r = p.r ?? range;
    const b = p.b === undefined ? branchId : p.b;
    if (r !== "30") q.set("r", r);
    if (b) q.set("b", b);
    const x = q.toString();
    return `/orders/desk${x ? `?${x}` : ""}`;
  };
  const listHref = (stage: OrderStage) => {
    const q = new URLSearchParams();
    q.set("stage", stage);
    if (branchId) q.set("b", branchId);
    if (mine) q.set("status", "mine");
    q.set("from_desk", "1");
    return `/orders?${q.toString()}`;
  };
  const locLabel = branchId === "dropship" ? "Drop ship" : branchId ? shortB(branchId) : "All";
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;
  void tabs;

  return (
    <main className="shell wide">
      <div className="o2 desk2">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href={mine ? "/orders?status=mine" : "/orders"} className="o2-back" aria-label="Back to orders"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <div className="row" style={{ gap: 10 }}>
                <h1>Order desk</h1>
                <Help label="How an order moves from step to step">
                  {mine
                    ? "The orders you placed and your customers' orders. Customer approves, then CRM adds the Sales Order #, accounting checks credit, CRM sets the date, and it's picked up or shipped out."
                    : "Order placed, then the customer approves, CRM adds the Sales Order #, accounting checks credit, and CRM sets the date (the customer is emailed). The warehouse loads it and the customer signs."}
                </Help>
              </div>
              <span className="o2-sub">Every open order, in the step it&apos;s on</span>
            </div>
          </div>
          <div className="o2-head-r">
            <MoreMenu label="Pick a location" triggerClass="stk-select ord-loc" trigger={<><span>Location</span><b>{locLabel}</b><ChevronDown size={16} aria-hidden="true" /></>}>
              <Link className="menu2-i" href={keep({ b: null })}>All locations</Link>
              {branchList.map((b) => <Link key={b.id} className="menu2-i" href={keep({ b: b.id })}>{b.name}</Link>)}
              <Link className="menu2-i" href={keep({ b: "dropship" })}>Drop ship</Link>
            </MoreMenu>
            <MoreMenu label="Pick the time range for the numbers" triggerClass="stk-select ord-loc" trigger={<><span>Numbers for</span><b>{rangeLabel}</b><ChevronDown size={16} aria-hidden="true" /></>}>
              {RANGES.map((r) => <Link key={r.key} className="menu2-i" href={keep({ r: r.key })}>{r.label}</Link>)}
            </MoreMenu>
            <Link href={mine ? "/orders?status=mine" : "/orders"} className="b2 quiet sm"><List size={16} /> All orders</Link>
          </div>
        </div>

        {setupMissing ? (
          <div className="alert warn">The order desk needs the database update for roles and the order desk (0011). Ask an admin to run it in Supabase.</div>
        ) : (
          <div className="desk-board" role="list" aria-label="Open orders by step" style={{ gridTemplateColumns: cols.map((c) => (c.rows.length ? "minmax(210px, 2fr)" : "minmax(118px, 1fr)")).join(" ") }}>
            {cols.map((c) => (
              <section key={c.stage} className={`desk-col${c.rows.length ? "" : " is-empty"}`} role="listitem" aria-label={`${STAGES[c.stage].short}: ${c.rows.length}`}>
                <Link href={listHref(c.stage)} className="desk-col-h">
                  <span className="row between" style={{ gap: 8 }}><b>{STAGES[c.stage].short}</b><span className="stk-n">{c.rows.length}</span></span>
                  <span className="desk-who">{c.who}</span>
                </Link>
                {c.rows.length === 0 ? <div className="desk-none">None</div> : null}
                {c.rows.slice(0, PER_COL).map((o) => {
                  const w = waitingSince({ ...o, stage: c.stage }, today);
                  const hours = w ? (Date.now() - new Date(w).getTime()) / 3600_000 : 0;
                  const chats = chatCounts.get(o.id) ?? 0;
                  const kind = (o as { kind?: string }).kind;
                  return (
                    <Link key={o.id} href={`/orders/${o.id}`} className="desk-card">
                      <span className="row between" style={{ gap: 8 }}>
                        <b>{orderNo(o.order_no)}</b>
                        {chats ? <span className="desk-chat" aria-label={`${chats} chat message${chats === 1 ? "" : "s"}`}>{chats}</span> : null}
                      </span>
                      <span className="desk-co">{o.company_name}</span>
                      <span className="desk-where">{whereTo(o)}</span>
                      {c.stage !== "scheduled" && hours >= 24 ? (
                        <span className={`ord-wait ${hours >= 72 ? "crit" : "warn"}`}>{hours >= 72 ? <OctagonAlert size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}Waiting {duration(hours)}</span>
                      ) : null}
                      {kind === "return" || kind === "exchange" || o.pay_prepaid || o.pay_cod || o.pay_no_checks || (o.pay_waiting_at && o.credit_status !== "approved") ? (
                        <span className="desk-tags">
                          {kind === "return" ? <span className="pill2 sm">Return</span> : kind === "exchange" ? <span className="pill2 sm">Exchange</span> : null}
                          {o.pay_prepaid ? <span className="pill2 ok sm">Paid</span> : null}
                          {o.pay_waiting_at && o.credit_status !== "approved" ? <span className="pill2 warn sm">Waiting on payment</span> : null}
                          {o.pay_cod ? <span className="pill2 err sm">COD only</span> : null}
                          {o.pay_no_checks ? <span className="pill2 err sm">No checks</span> : null}
                        </span>
                      ) : null}
                      {c.stage === "hold" && o.credit_note ? <span className="desk-note">Hold: {o.credit_note}</span> : null}
                    </Link>
                  );
                })}
                {c.rows.length > PER_COL ? <Link href={listHref(c.stage)} className="desk-more">+ {c.rows.length - PER_COL} more</Link> : null}
              </section>
            ))}
          </div>
        )}

        {stats ? (
          <DeskDashboard stats={stats} range={range} branch={branchId} tab={sp.tab ?? null} branches={branchList.map((b) => ({ id: b.id, name: b.name }))} mine={mine} hideFilters />
        ) : !setupMissing ? (
          <div className="alert warn small">The numbers need database update 0024. Ask an admin to run it in Supabase; the board above still works.</div>
        ) : null}
      </div>
    </main>
  );
}
