import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronLeft, ExternalLink, Mail, Phone } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { monthDay, money } from "@/lib/format";
import { Empty } from "@/components/ui";
import { setAdcOrderStatus } from "./actions";

export const metadata = { title: "ADC web orders" };
export const dynamic = "force-dynamic";

type Line = { sku: string; name: string; qty: number; price: number | null; on_sale?: boolean; promo?: string | null };
type WebOrder = {
  id: number; created_at: string; status: "new" | "working" | "done" | "cancelled"; name: string; company: string | null; email: string; phone: string;
  delivery: "ship" | "pickup"; pickup_branch: string | null; address: { street: string; street2: string; city: string; state: string; zip: string } | null;
  notes: string | null; items: Line[]; subtotal: number; has_quote: boolean; sale_slug: string | null; email_status: string | null;
  staff_note: string | null; handled_by_name: string | null; handled_at: string | null;
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

  return (
    <main className="shell wide">
      <div className="o2 webo">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/orders" className="o2-back" aria-label="Back to orders"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>ADC web orders</h1>
              <span className="o2-sub">Placed as a guest on the ADC store · no payment taken · call or email to confirm</span>
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
                <details key={o.id} className="acc-item" open={i === 0 && o.status === "new"}>
                  <summary className="acc-sum">
                    <span className="acc-who">
                      <b>ADC-{1000 + o.id} · {o.company || o.name}</b>
                      <span>{monthDay(o.created_at)} · {o.items.length} {o.items.length === 1 ? "line" : "lines"} · {money(o.subtotal)}{o.has_quote ? " + items to price" : ""}{o.delivery === "pickup" ? ` · pick up at ${bname.get(o.pickup_branch ?? "") ?? o.pickup_branch}` : o.address ? ` · ship to ${o.address.city}, ${o.address.state}` : ""}</span>
                    </span>
                    <span className="acc-tags">
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
                        : o.address
                          ? `Ship to ${o.address.street}${o.address.street2 ? `, ${o.address.street2}` : ""}, ${o.address.city}, ${o.address.state} ${o.address.zip}`
                          : ""}
                      {o.email_status ? ` · emailed to orders@: ${o.email_status === "sent" ? "yes" : o.email_status.replace("_", " ")}` : ""}
                    </div>
                    <table className="webo-t">
                      <thead><tr><th>Part #</th><th>Item</th><th className="n">Qty</th><th className="n">Each</th><th className="n">Total</th></tr></thead>
                      <tbody>
                        {o.items.map((l, k) => (
                          <tr key={k}>
                            <td className="sku">{l.sku}</td>
                            <td>{l.name}{l.on_sale ? <span className="pill2 err sm" style={{ marginLeft: 6 }}>Sale</span> : null}{l.promo ? <div className="tiny red">{l.promo}</div> : null}</td>
                            <td className="n">{l.qty}</td>
                            <td className="n">{l.price === null ? <span className="faint">To price</span> : money(l.price)}</td>
                            <td className="n">{l.price === null ? "-" : money(l.price * l.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {o.notes ? <div className="small"><b>Their notes:</b> {o.notes}</div> : null}
                    {o.handled_by_name ? <div className="tiny faint">Last update by {o.handled_by_name}{o.handled_at ? ` · ${monthDay(o.handled_at)}` : ""}{o.staff_note ? `: ${o.staff_note}` : ""}</div> : null}
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
