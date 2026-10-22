import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort, money, orderNo } from "@/lib/format";
import { STAGES } from "@/lib/order-desk";
import { Empty, TopBar } from "@/components/ui";
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
  const { supabase, profile } = await requirePerm("order_desk", "credit_check");
  const desk = can(profile, "order_desk");
  const credit = can(profile, "credit_check");
  const tabs = TABS.filter((t) => t.who === "both" || (t.who === "desk" ? desk : credit));

  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const counts = await Promise.all(
    tabs.map((t) => {
      let q = supabase.from("orders").select("id", { count: "exact", head: true }).eq("stage", t.stage);
      if (t.stage === "completed") q = q.gte("completed_at", since);
      return Promise.resolve(q).then((r) => (r.error ? -1 : r.count ?? 0));
    }),
  );
  const setupMissing = counts.some((c) => c === -1);
  const first = tabs.find((t, i) => counts[i] > 0 && t.stage !== "completed" && t.stage !== "scheduled") ?? tabs[0];
  const tab = tabs.find((t) => t.stage === sp.tab) ?? first;

  let rows: Order[] = [];
  if (!setupMissing) {
    let q = supabase.from("orders").select("*").eq("stage", tab.stage).limit(200);
    if (tab.stage === "completed") q = q.gte("completed_at", since).order("completed_at", { ascending: false });
    else if (tab.stage === "scheduled") q = q.order("scheduled_for", { ascending: true });
    else q = q.order("created_at", { ascending: true }); // oldest waiting first
    rows = ((await q).data ?? []) as Order[];
  }
  const { data: branchRows } = await supabase.from("branches").select("id, name, state");
  const branches = new Map(((branchRows ?? []) as Branch[]).map((b) => [b.id, b]));

  return (
    <main className="shell">
      <TopBar title="Order desk" back="/" />
      <p className="small muted" style={{ margin: 0 }}>
        Order placed → customer approves → CRM adds the AMBIT PO # → accounting checks credit → CRM sets the date and the customer is emailed.
      </p>

      {setupMissing ? (
        <div className="alert warn">The order desk needs the database update for roles and the order desk (0011). Ask an admin to run it in Supabase.</div>
      ) : (
        <>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {tabs.map((t, i) => (
              <Link key={t.stage} href={`/orders/desk?tab=${t.stage}`} className={`chip${tab.stage === t.stage ? " on" : ""}`}>
                {STAGES[t.stage].short}
                {counts[i] > 0 ? ` · ${counts[i]}` : ""}
              </Link>
            ))}
          </div>
          <div className="eyebrow">{STAGES[tab.stage].label}{tab.stage === "completed" ? " · last 30 days" : ""}</div>

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
                        {[where, o.ambit_po ? `AMBIT PO ${o.ambit_po}` : null, o.po_number ? `Cust. PO ${o.po_number}` : null].filter(Boolean).join(" · ")}
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
