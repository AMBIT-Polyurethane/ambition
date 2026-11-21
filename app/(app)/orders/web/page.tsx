import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronLeft, CircleAlert, CircleCheck, ExternalLink, FlaskConical, Mail, Phone, Route, Trash2, Truck, UserRound } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { monthDay, money } from "@/lib/format";
import { Empty } from "@/components/ui";
import { acceptAdcOrder, deleteAdcTest, setAdcOrderStatus, setAdcTest } from "./actions";
import { WebPay } from "./pay";

export const metadata = { title: "ADC web orders" };
export const dynamic = "force-dynamic";

type Line = { sku: string; name: string; qty: number; price: number | null; on_sale?: boolean; promo?: string | null; set?: boolean; ship?: string };
type WebOrder = {
  id: number; created_at: string; status: "new" | "working" | "done" | "cancelled"; name: string; company: string | null; email: string; phone: string;
  delivery: "ship" | "pickup" | "truckload"; pickup_branch: string | null; address: { street: string; street2: string; city: string; state: string; zip: string } | null;
  notes: string | null; items: Line[]; subtotal: number; has_quote: boolean; sale_slug: string | null; email_status: string | null;
  staff_note: string | null; handled_by_name: string | null; handled_at: string | null;
  user_id?: string | null; promo_opt_in?: boolean | null; bucks_requested?: number | null; paid_total?: number | null; paid_at?: string | null;
  points_earned?: number | null; bucks_used?: number | null; is_test?: boolean | null;
  match?: string | null; ship_est?: number | null; alerts?: string[] | null; company_id?: string | null;
  sms_opt_in?: boolean | null;
};
const MATCH: Record<string, [string, string]> = {
  verified: ["AMBIT customer (by name)", "pill2 ok sm"],
  unverified: ["Not verified", "pill2 err sm"],
  added: ["New customer", "pill2 err sm"],
  new: ["New customer", "pill2 err sm"],
};
const STATUS = { new: ["New", "pill2 warn sm"], working: ["Working on it", "pill2 sm"], done: ["Done", "pill2 ok sm"], cancelled: ["Cancelled", "pill2 sm"] } as const;

/** Orders guests placed on the ADC web store. No payment was taken: call or email, confirm, then enter the real order. */
export default async function AdcOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!isEmployee(profile) || !(profile.role === "admin" || can(profile, "order_desk") || can(profile, "ordering"))) redirect("/");
  const show = sp.s === "all" ? "all" : "open";
  let q = supabase.from("adc_orders").select("*").order("created_at", { ascending: false }).limit(300);
  if (show === "open") q = q.in("status", ["new", "working"]);
  const { data, error } = await q;
  const orders = (data ?? []) as WebOrder[];
  const { data: br } = await supabase.from("branches").select("id, name");
  const bname = new Map(((br ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const canEdit = profile.role === "admin" || can(profile, "order_desk");
  const isAdmin = profile.role === "admin";
  const where = (o: WebOrder) =>
    o.delivery === "pickup" ? ` · pick up at ${bname.get(o.pickup_branch ?? "") ?? o.pickup_branch ?? "a location"}` : o.delivery === "truckload" ? " · FULL TRUCK" : o.address ? ` · ship to ${o.address.city}, ${o.address.state}` : "";

  return (
    <main className="shell wide">
      <div className="o2 webo">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/orders" className="o2-back" aria-label="Back to orders"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>ADC web orders</h1>
              <span className="o2-sub">From the ADC store · no payment taken · call or email within 4 hours to confirm · mark paid to post AM-BUCKS</span>
            </div>
          </div>
          <div className="o2-head-r">
            <a href="/adc" target="_blank" rel="noopener noreferrer" className="b2 quiet sm"><ExternalLink size={16} /> Open the store</a>
          </div>
        </div>
        <nav className="seg2" aria-label="Show">
          <Link href="/orders/web" className={show === "open" ? "on" : undefined}>Open</Link>
          <Link href="/orders/web?s=all" className={show === "all" ? "on" : undefined}>Everything</Link>
        </nav>
        {error ? <div className="alert warn">ADC web orders need database update 0091. Ask Jeremiah to run it.</div> : null}
        {!error && !orders.length ? <Empty icon="cart" title={show === "open" ? "No open web orders" : "No web orders yet"}>Orders from the ADC store show up here.</Empty> : null}
        {orders.length ? (
          <div className="card2 acc-list">
            {orders.map((o, i) => {
              const [label, pill] = STATUS[o.status];
              return (
                <details key={o.id} id={`web-${o.id}`} className="acc-item" open={sp.open ? sp.open === String(o.id) : i === 0 && o.status === "new"}>
                  <summary className="acc-sum">
                    <span className="acc-who">
                      <b>ADC-{1000 + o.id} · {o.company || o.name}</b>
                      <span>{monthDay(o.created_at)} · {o.items.length} {o.items.length === 1 ? "line" : "lines"} · {money(o.subtotal)}{o.has_quote ? " + items to price" : ""}{where(o)}</span>
                    </span>
                    <span className="acc-tags">
                      {o.is_test ? <span className="pill2 sm webo-test">Test</span> : null}
                      {o.alerts?.length && !o.paid_at && o.status !== "done" && o.status !== "cancelled" ? <span className="pill2 err sm">Action needed</span> : null}
                      {o.match && MATCH[o.match] ? <span className={MATCH[o.match][1]}>{MATCH[o.match][0]}</span> : null}
                      {o.user_id ? <span className="pill2 sm" title="Has an ADC account">Account</span> : null}
                      {o.sms_opt_in ? <span className="pill2 ok sm" title="Ticked: text me order updates">Texts OK</span> : null}
                      {o.delivery === "truckload" ? <span className="pill2 warn sm">Full truck</span> : null}
                      {o.paid_at ? <span className="pill2 ok sm">Paid</span> : null}
                      {o.sale_slug ? <span className="pill2 err sm">Sale</span> : null}
                      <span className={pill}>{label}</span>
                    </span>
                    <ChevronDown size={18} className="prd-chev" aria-hidden="true" />
                  </summary>
                  <div className="acc-form webo-in">
                    <div className="webo-who">
                      <span><b>{o.name}</b>{o.company ? ` · ${o.company}` : ""}</span>
                      <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} className="b2 quiet sm"><Phone size={15} /> {o.phone}</a>
                      <a href={`mailto:${o.email}?subject=${encodeURIComponent(`Your ADC order ADC-${1000 + o.id}`)}`} className="b2 quiet sm"><Mail size={15} /> {o.email}</a>
                    </div>
                    <div className="small muted">
                      {o.delivery === "pickup"
                        ? `Picks up at ${bname.get(o.pickup_branch ?? "") ?? o.pickup_branch ?? "an AMBIT location"}`
                        : o.delivery === "truckload" && !o.address
                          ? "Full truckload (address to confirm)"
                          : o.address
                          ? `${o.delivery === "truckload" ? "FULL TRUCK to" : "Ship to"} ${o.address.street}${o.address.street2 ? `, ${o.address.street2}` : ""}, ${o.address.city}, ${o.address.state} ${o.address.zip}`
                          : ""}
                      {o.email_status ? ` · emailed to orders@: ${o.email_status === "sent" ? "yes" : o.email_status.replace("_", " ")}` : ""}
                    </div>
                    <div className="webo-flags small">
                      <span><UserRound size={14} aria-hidden="true" /> {o.user_id ? "Ordered with an ADC account" : "Guest (no account)"}</span>
                      {o.bucks_requested ? <span className="webo-bucks">Wants to use {money(o.bucks_requested)} in AM-BUCKS</span> : null}
                      {o.promo_opt_in ? <span>OK to email deals</span> : null}
                      {o.delivery === "truckload" ? <span><Truck size={14} aria-hidden="true" /> Full truckload: confirm the load and freight</span> : null}
                    </div>
                    {o.alerts?.length ? (
                      <div className="webo-red" role="alert">
                        <b><CircleAlert size={15} aria-hidden="true" /> Action needed before this ships</b>
                        {o.alerts.map((x, k) => <span key={k}>{x}</span>)}
                      </div>
                    ) : null}
                    <div className="webo-flags small">
                      {o.delivery !== "pickup" && o.ship_est !== null && o.ship_est !== undefined ? <span><Truck size={14} aria-hidden="true" /> Customer saw {money(o.ship_est)} estimated shipping</span> : null}
                      <Link href={`/orders/web/${o.id}/strategy`} className="b2 quiet sm"><Route size={15} /> Best Strategy sheet</Link>
                      {canEdit && !o.is_test && (o.status === "new" || o.status === "working") ? (
                        <form action={acceptAdcOrder}>
                          <input type="hidden" name="id" value={o.id} />
                          <button type="submit" className="b2 sm" title="Opens it as a normal A.I. order, ready to send: placing it holds the stock and puts it on PENDING ORDERS."><CircleCheck size={15} /> Accept: make it an A.I. order</button>
                        </form>
                      ) : null}
                      {o.company_id ? <Link href={`/customers/${o.company_id}`} className="b2 quiet sm"><UserRound size={15} /> Customer in A.I.</Link> : null}
                    </div>
                    <table className="webo-t">
                      <thead><tr><th>Part #</th><th>Item</th><th className="n">Qty</th><th className="n">Each</th><th className="n">Total</th></tr></thead>
                      <tbody>
                        {o.items.map((l, k) => (
                          <tr key={k}>
                            <td className="sku">{l.sku}</td>
                            <td>{l.name}{l.set ? <span className="pill2 sm" style={{ marginLeft: 6 }}>Set: 1 A + 1 B</span> : null}{l.ship === "pickup" ? <span className="pill2 warn sm" style={{ marginLeft: 6 }}>Pick up only</span> : l.ship === "truckload" ? <span className="pill2 warn sm" style={{ marginLeft: 6 }}>Truckload</span> : l.ship === "freight" ? <span className="pill2 sm" style={{ marginLeft: 6 }}>Freight</span> : null}{l.on_sale ? <span className="pill2 err sm" style={{ marginLeft: 6 }}>Sale</span> : null}{l.promo ? <div className="tiny red">{l.promo}</div> : null}</td>
                            <td className="n">{l.qty}</td>
                            <td className="n">{l.price === null ? <span className="faint">To price</span> : money(l.price)}</td>
                            <td className="n">{l.price === null ? "-" : money(l.price * l.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {o.notes ? <div className="small"><b>Their notes:</b> {o.notes}</div> : null}
                    {o.handled_by_name ? <div className="tiny faint">Last update by {o.handled_by_name}{o.handled_at ? ` · ${monthDay(o.handled_at)}` : ""}{o.staff_note ? `: ${o.staff_note}` : ""}</div> : null}
                    {o.paid_at ? (
                      <div className="webo-paid small">
                        <b>Paid {money(o.paid_total ?? 0)}</b> · {monthDay(o.paid_at)}
                        {o.points_earned ? ` · earned ${o.points_earned} points (${money(o.points_earned / 100)})` : o.user_id ? "" : " · no account, no AM-BUCKS"}
                        {o.bucks_used ? ` · used ${money(o.bucks_used)} in AM-BUCKS` : ""}
                      </div>
                    ) : canEdit && o.status !== "cancelled" && !o.is_test ? (
                      <WebPay id={o.id} guess={o.has_quote ? 0 : Number(o.subtotal) - Number(o.bucks_requested ?? 0)} bucks={o.bucks_requested ?? null} hasAccount={Boolean(o.user_id) || Boolean(o.bucks_requested)} />
                    ) : null}
                    {canEdit ? (
                      <div className="webo-test-row">
                        <form action={setAdcTest}>
                          <input type="hidden" name="id" value={o.id} />
                          <input type="hidden" name="on" value={o.is_test ? "0" : "1"} />
                          <button type="submit" className="b2 quiet sm"><FlaskConical size={15} /> {o.is_test ? "Not a test order" : "This is a test order"}</button>
                        </form>
                        {isAdmin && (o.is_test || o.status === "cancelled") ? (
                          <form action={deleteAdcTest}>
                            <input type="hidden" name="id" value={o.id} />
                            <button type="submit" className="b2 quiet sm danger"><Trash2 size={15} /> Delete for good</button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                    {canEdit ? (
                      <form action={setAdcOrderStatus} className="webo-act">
                        <input type="hidden" name="id" value={o.id} />
                        <input className="input sm" name="note" defaultValue={o.staff_note ?? ""} placeholder="Note (called them, entered as ORD-1234...)" />
                        {o.status !== "working" ? <button type="submit" className="b2 quiet sm" name="status" value="working">Working on it</button> : null}
                        {o.status !== "done" ? <button type="submit" className="b2 sm" name="status" value="done">Done</button> : null}
                        {o.status !== "cancelled" ? <button type="submit" className="b2 quiet sm" name="status" value="cancelled">Cancel</button> : null}
                      </form>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : null}
      </div>
    </main>
  );
}
