import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { can, seesOrders } from "@/lib/access";
import { STAGES, stageOf } from "@/lib/order-desk";
import { dateShort, money, orderNo, searchSafe } from "@/lib/format";
import { ApprovalPill, Empty, StatusPill, TopBar } from "@/components/ui";
import type { Order } from "@/lib/types";

export const metadata = { title: "Orders" };

const FILTERS = [
  ["all", "All"],
  ["new", "New"],
  ["approval", "Needs approval"],
  ["processing", "Processing"],
  ["completed", "Completed"],
  ["mine", "Mine"],
] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  if (!seesOrders(profile)) redirect("/");
  const filter = sp.status ?? "all";
  const q = searchSafe(sp.q);

  let query = supabase
    .from("orders")
    .select("*") // includes the approval columns when the database has them
    .order("created_at", { ascending: false })
    .limit(200);
  if (["new", "processing", "completed", "cancelled"].includes(filter)) query = query.eq("status", filter);
  if (filter === "mine") query = query.eq("placed_by", profile.id);
  if (filter === "approval") query = query.in("approval_status", ["pending", "changes_requested"]).neq("status", "cancelled");
  if (q) {
    const n = Number(q.replace(/\D/g, ""));
    query = n ? query.or(`order_no.eq.${n},po_number.ilike.%${q}%,ambit_po.ilike.%${q}%`) : query.or(`company_name.ilike.%${q}%,po_number.ilike.%${q}%,ambit_po.ilike.%${q}%`);
  }
  const { data } = await query;
  const orders = (data ?? []) as Order[];

  return (
    <main className="shell">
      <TopBar
        title={emp ? "Orders" : "My orders"}
        back="/"
        right={emp && (can(profile, "order_desk") || can(profile, "credit_check")) ? <Link href="/orders/desk" className="btn sm dark">Order desk</Link> : null}
      />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {emp ? (
        <>
          <form className="search" action="/orders">
            <input type="hidden" name="status" value={filter} />
            <input className="input" name="q" defaultValue={q} placeholder="Search customer, order #, PO or Sales Order #" aria-label="Search orders" style={{ paddingLeft: 16 }} />
          </form>
          <div className="chips">
            {FILTERS.map(([id, label]) => (
              <Link key={id} href={`/orders?status=${id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${filter === id ? " on" : ""}`}>{label}</Link>
            ))}
          </div>
        </>
      ) : null}

      {orders.length === 0 ? (
        <Empty icon="cart" title="No orders yet">
          {emp ? "Orders placed in AMBIT Intelligence show up here." : <Link href="/order">Place your first order</Link>}
        </Empty>
      ) : (
        <div className="list">
          {orders.map((o) => (
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
                  {dateShort(o.created_at)}
                  {Number(o.est_subtotal) > 0 ? ` · ${money(o.est_subtotal)}${o.has_customer_pricing ? " + customer-priced items" : ""}` : o.has_customer_pricing ? " · Customer pricing" : ""}
                </div>
              </div>
              <ChevronRight size={18} className="chev" />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
