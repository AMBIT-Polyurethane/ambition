import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { List } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort, money, orderNo } from "@/lib/format";
import { STAGES, deskAccess } from "@/lib/order-desk";
import { Empty, TopBar } from "@/components/ui";
import { DeskDashboard } from "@/components/desk-dashboard";
import { RANGES, type DeskStats, type RangeKey } from "@/lib/desk-stats";
import type { Branch, Order, OrderStage } from "@/lib/types";

export const metadata = { title: "Order desk" };
export const dynamic = "force-dynamic";

type Tab = { stage: OrderStage; who: "desk" | "credit" | "both" };

// Each queue, and who works it. CRM = order desk box, Accounting = credit check box.
const TABS: Tab[] = [
  { stage: "needs_po", who: "desk" },
  { stage: "credit", who: "credit" },
  { stage: "schedule", who: "desk" },
  { stage: "hold", who: "both" },
  { stage: "scheduled", who: "both" },
  { stage: "customer", who: "desk" },
  { stage: "completed", who: "both" },
];

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

  const counts = await Promise.all(
    tabs.map((t) => {
      let q = where(supabase.from("orders").select("id", { count: "exact", head: true }).eq("stage", t.stage));
      if (t.stage === "completed") q = q.gte("completed_at", since);
      return Promise.resolve(q).then((r) => (r.error ? -1 : r.count ?? 0));
    }),
  );
  const setupMissing = counts.some((c) => c === -1);
  const first = tabs.find((t, i) => counts[i] > 0 && t.stage !== "completed" && t.stage !== "scheduled") ?? tabs[0];
  const tab = tabs.find((t) => t.stage === sp.tab) ?? first;

  let rows: Order[] = [];
  if (!setupMissing) {
    let q = where(supabase.from("orders").select("*").eq("stage", tab.stage)).limit(200);
    if (tab.stage === "completed") q = q.gte("completed_at", since).order("completed_at", { ascending: false });
    else if (tab.stage === "scheduled") q = q.order("scheduled_for", { ascending: true });
    else q = q.order("created_at", { ascending: true }); // oldest waiting first
    rows = ((await q).data ?? []) as Order[];
  }
  const branches = new Map(branchList.map((b) => [b.id, b]));
  const keep = (t: string) => {
    const q = new URLSearchParams();
    if (range !== "30") q.set("r", range);
    if (branchId) q.set("b", branchId);
    q.set("tab", t);
    return `/orders/desk?${q.toString()}`;
  };
  const rangeLabel = range === "year" ? "this year" : `last ${range} days`;

  return (
    <main className="shell wide">
      <TopBar
        title="Order desk"
        back="/"
        right={
          <Link href={mine ? "/orders?status=mine" : "/orders"} className="btn sm">
            <List size={16} /> View orders
          </Link>
        }
      />
      <p className="small muted" style={{ margin: 0 }}>
        {mine
          ? "The orders you placed and your customers' orders, and where each one is: customer approves → CRM adds the Sales Order # → accounting checks credit → CRM sets the date → picked up or delivered."
          : "Order placed → customer approves → CRM adds the Sales Order # → accounting checks credit → CRM sets the date and the customer is emailed."}
      </p>

      {stats ? (
        <DeskDashboard
          stats={stats}
          range={range}
          branch={branchId}
          tab={sp.tab ?? null}
          branches={branchList.map((b) => ({ id: b.id, name: b.name }))}
          mine={mine}
        />
      ) : !setupMissing ? (
        <div className="alert warn small">The dashboard needs database update 0024. Ask an admin to run it in Supabase; the order lists below still work.</div>
      ) : null}

      {setupMissing ? (
        <div className="alert warn">The order desk needs the database update for roles and the order desk (0011). Ask an admin to run it in Supabase.</div>
      ) : (
        <>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {tabs.map((t, i) => (
              <Link key={t.stage} href={keep(t.stage)} scroll={false} className={`chip${tab.stage === t.stage ? " on" : ""}`}>
                {STAGES[t.stage].short}
                {counts[i] > 0 ? ` · ${counts[i]}` : ""}
              </Link>
            ))}
          </div>
          <div className="eyebrow" id="queue">
            {STAGES[tab.stage].label}
            {tab.stage === "completed" ? ` · ${rangeLabel}` : ""}
            {branchId ? ` · ${branchId === "dropship" ? "Drop ship" : branches.get(branchId)?.name ?? branchId}` : ""}
          </div>

          {rows.length === 0 ? (
            <Empty icon="clipboard" title="Nothing here right now" />
          ) : (
            <div className="list">
              {rows.map((o) => {
                const b = o.branch_id ? branches.get(o.branch_id) : null;
                const where = o.delivery_method === "pickup" ? `Pickup ${b ? b.name : ""}` : o.delivery_method === "jobsite" ? `Job site${b ? ` from ${b.name}` : ""}` : "Drop ship";
                return (
                  <Link key={o.id} href={`/orders/${o.id}`} className="item">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row between" style={{ gap: 8 }}>
                        <span className="t">{orderNo(o.order_no)} · <span style={{ fontWeight: 600 }}>{o.company_name}</span></span>
                        {o.scheduled_for && (tab.stage === "scheduled" || tab.stage === "completed") ? <span className="pill ok">{dateShort(o.scheduled_for)}</span> : null}
                      </div>
                      <div className="s ellipsis">
                        {[where, o.ambit_po ? `Sales Order # ${o.ambit_po}` : null, o.invoice_no ? `Invoice # ${o.invoice_no}` : null, o.po_number ? `Cust. PO ${o.po_number}` : null].filter(Boolean).join(" · ")}
                      </div>
                      {tab.stage === "hold" && o.credit_note ? <div className="tiny red ellipsis">Hold: {o.credit_note}</div> : null}
                      <div className="tiny faint">
                        Placed {dateShort(o.created_at)} by {o.placed_by_name ?? o.placed_by_email}
                        {o.needed_by ? ` · needed by ${dateShort(o.needed_by)}` : ""}
                        {Number(o.est_subtotal) > 0 ? ` · ${money(o.est_subtotal)}${o.has_customer_pricing ? " +" : ""}` : ""}
                      </div>
                    </div>
                    <ChevronRight size={18} className="chev" />
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
