import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, RefreshCw } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { DELIVERY_LABEL, dateShort, dateTime, money, orderNo, qtyText } from "@/lib/format";
import { StatusPill, TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { resendOrderEmail, setOrderStatus } from "@/app/(app)/orders/actions";
import type { Branch, Order, OrderItem } from "@/lib/types";

export const metadata = { title: "Order" };

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);

  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) notFound();
  const [{ data: items }, { data: branch }] = await Promise.all([
    supabase.from("order_items").select("*, product:products(image_url)").eq("order_id", id).order("id"),
    order.branch_id ? supabase.from("branches").select("*").eq("id", order.branch_id).maybeSingle<Branch>() : Promise.resolve({ data: null }),
  ]);
  const lines = (items ?? []) as (OrderItem & { product: { image_url: string | null } | null })[];
  const justSent = sp.sent === "1";

  return (
    <main className="shell">
      {justSent ? (
        <div className="col" style={{ alignItems: "center", gap: 14, paddingTop: 30, textAlign: "center" }}>
          <div className="done-mark"><Check size={40} strokeWidth={3} /></div>
          <h1 className="h1">Order sent</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 360 }}>
            {order.email_status === "sent"
              ? `${orderNo(order.order_no)} went to orders@ambitpu.com and a copy is in your inbox. AMBIT will confirm pricing and timing.`
              : `${orderNo(order.order_no)} is saved and the AMBIT team can see it. AMBIT will confirm pricing and timing.`}
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/" className="btn dark sm">Back home</Link>
            <Link href="/order" className="btn sm">Place another</Link>
          </div>
        </div>
      ) : (
        <TopBar title={orderNo(order.order_no)} back="/orders" right={<StatusPill status={order.status} />} />
      )}

      <section className="card">
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Order</dt><dd>{orderNo(order.order_no)}</dd>
          <dt>Customer</dt><dd>{order.company_name}{order.account_no ? ` · ${order.account_no}` : ""}</dd>
          <dt>Placed by</dt><dd>{order.placed_by_name ?? order.placed_by_email}{order.placed_by_role !== "customer" ? " (AMBIT)" : ""}</dd>
          <dt>Submitted</dt><dd>{dateTime(order.created_at)}</dd>
          <dt>Delivery</dt>
          <dd>
            {DELIVERY_LABEL[order.delivery_method]}
            {order.delivery_method === "pickup" ? `: ${branch ? `${branch.name}, ${branch.state}` : order.branch_id}` : `\n${order.ship_address ?? ""}`}
          </dd>
          {order.po_number ? (<><dt>PO number</dt><dd>{order.po_number}</dd></>) : null}
          {order.needed_by ? (<><dt>Needed by</dt><dd>{dateShort(order.needed_by)}</dd></>) : null}
          {order.notes ? (<><dt>Notes</dt><dd>{order.notes}</dd></>) : null}
        </dl>
      </section>

      <section className="section">
        <div className="eyebrow">{lines.length} {lines.length === 1 ? "item" : "items"}</div>
        <div className="list">
          {lines.map((l) => (
            <div key={l.id} className="product">
              {l.product?.image_url ? <img className="thumb sm" src={l.product.image_url} alt="" loading="lazy" /> : null}
              <div className="grow">
                <div className="name">{l.name}</div>
                <div className="desc">{l.sku} · {qtyText(l.qty, l.unit)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {l.customer_priced ? (
                  <span className="cp-tag">Customer pricing</span>
                ) : l.line_total !== null ? (
                  <>
                    <div style={{ fontWeight: 800 }}>{money(l.line_total)}</div>
                    <div className="tiny faint">{money(l.unit_price)} / {l.unit}</div>
                  </>
                ) : (
                  <span className="tiny faint">On invoice</span>
                )}
              </div>
            </div>
          ))}
          <div className="row between" style={{ padding: "14px 16px" }}>
            <span className="muted small">Estimated list-price subtotal</span>
            <b>{money(order.est_subtotal)}</b>
          </div>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Final pricing, tax and freight are confirmed by AMBIT on the invoice.</p>
      </section>

      <Link href={`/order?reorder=${order.id}`} className="btn dark block"><RefreshCw size={16} /> Reorder these items</Link>

      {emp ? (
        <section className="section">
          <div className="eyebrow">AMBIT team</div>
          <form action={setOrderStatus} className="row" style={{ gap: 10 }}>
            <input type="hidden" name="id" value={order.id} />
            <select name="status" className="select" defaultValue={order.status} style={{ flex: 1 }} aria-label="Order status">
              <option value="new">New</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <Submit className="btn sm" pendingText="Saving…">Update</Submit>
          </form>
          <div className={`alert ${order.email_status === "sent" ? "ok" : order.email_status === "failed" ? "err" : "info"}`} style={{ alignItems: "center" }}>
            <span className="grow small">
              {order.email_status === "sent" && "Emailed to orders@ambitpu.com."}
              {order.email_status === "failed" && `Email failed: ${order.email_error ?? "unknown error"}`}
              {order.email_status === "not_configured" && "Email sending isn't set up yet, so this order was saved here only."}
              {order.email_status === "pending" && "Email not sent yet."}
            </span>
            <form action={resendOrderEmail}>
              <input type="hidden" name="id" value={order.id} />
              <Submit className="btn sm dark" pendingText="Sending…">{order.email_status === "sent" ? "Resend" : "Send email"}</Submit>
            </form>
          </div>
        </section>
      ) : null}
    </main>
  );
}
