import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, CircleAlert, CircleCheck, FileDown, MailCheck, RefreshCw } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { DELIVERY_LABEL, dateShort, dateTime, money, orderNo, qtyText } from "@/lib/format";
import { ApprovalPill, StatusPill, TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { customerDecision, recordApproval, resendApproval, resendOrderEmail, setOrderStatus } from "@/app/(app)/orders/actions";
import { docState } from "@/lib/order-doc/types";
import type { Branch, Company, Order, OrderItem } from "@/lib/types";

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
  const [{ data: items }, { data: branch }, { data: company }] = await Promise.all([
    supabase.from("order_items").select("*, product:products(image_url)").eq("order_id", id).order("id"),
    order.branch_id ? supabase.from("branches").select("*").eq("id", order.branch_id).maybeSingle<Branch>() : Promise.resolve({ data: null }),
    emp && order.company_id
      ? supabase.from("companies").select("email, contact_name").eq("id", order.company_id).maybeSingle<Pick<Company, "email" | "contact_name">>()
      : Promise.resolve({ data: null }),
  ]);
  const lines = (items ?? []) as (OrderItem & { product: { image_url: string | null } | null })[];
  const state = docState(order);
  const waiting = state === "pending" || state === "expired" || state === "changes_requested";
  const justSent = sp.sent === "1" || sp.sent === "approval";
  const contractorDecides = !emp && profile.role === "customer" && order.placed_by_role !== "customer" && state === "pending";
  const where = order.delivery_method === "pickup"
    ? `: ${branch ? `${branch.name}, ${branch.state}` : order.branch_id}`
    : `${branch && order.delivery_method === "jobsite" ? ` from ${branch.name}, ${branch.state}` : ""}\n${order.ship_address ?? ""}`;

  return (
    <main className="shell">
      {justSent ? (
        <div className="col" style={{ alignItems: "center", gap: 14, paddingTop: 30, textAlign: "center" }}>
          <div className="done-mark">
            {sp.sent !== "approval" ? <Check size={40} strokeWidth={3} /> : order.approval_email_status === "sent" ? <MailCheck size={38} strokeWidth={2.4} /> : <CircleAlert size={38} strokeWidth={2.4} />}
          </div>
          <h1 className="h1">
            {sp.sent === "approval"
              ? order.approval_email_status === "sent" ? "Sent for approval" : "Order saved, not sent"
              : profile.role === "customer" ? "Order approved" : "Order sent"}
          </h1>
          <p className="muted" style={{ margin: 0, maxWidth: 380 }}>
            {sp.sent === "approval"
              ? order.approval_email_status === "sent"
                ? `${orderNo(order.order_no)} was emailed to ${order.approval_email} to approve. It goes to orders@ambitpu.com as soon as they approve, and you'll get a copy.`
                : `${orderNo(order.order_no)} is saved, but the approval email didn't go out. Check the email address below and tap Resend.`
              : order.email_status === "sent"
                ? `${orderNo(order.order_no)} went to orders@ambitpu.com and a copy is in your inbox. AMBIT will confirm pricing and timing.`
                : `${orderNo(order.order_no)} is saved and the AMBIT team can see it. AMBIT will confirm pricing and timing.`}
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/" className="btn dark sm">Back home</Link>
            <Link href="/order" className="btn sm">Place another</Link>
          </div>
        </div>
      ) : (
        <TopBar
          title={orderNo(order.order_no)}
          back="/orders"
          right={waiting ? <ApprovalPill order={order} /> : <StatusPill status={order.status} />}
        />
      )}

      {sp.msg ? (
        <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div>
      ) : null}
      {sp.err ? (
        <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div>
      ) : null}

      {contractorDecides ? (
        <section className="card col" style={{ gap: 12, borderColor: "var(--warn)" }}>
          <div>
            <div className="eyebrow" style={{ color: "var(--warn)" }}>Waiting for your approval</div>
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              {order.placed_by_name ?? "AMBIT"} put this order together for {order.company_name}. Check the items and delivery details below. Nothing ships until you approve.
            </p>
          </div>
          <form action={customerDecision}>
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="decision" value="approve" />
            <Submit className="btn block" pendingText="Approving…">Approve order</Submit>
          </form>
          <details>
            <summary className="linkbtn">Something not right? Request changes</summary>
            <form action={customerDecision} className="col" style={{ gap: 10, marginTop: 10 }}>
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="decision" value="changes" />
              <textarea className="textarea" name="note" rows={3} required placeholder="What needs to change? Quantities, items, delivery date…" />
              <Submit className="btn dark sm" pendingText="Sending…">Send to my AMBIT rep</Submit>
            </form>
          </details>
        </section>
      ) : null}

      <section className="card">
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Order</dt><dd>{orderNo(order.order_no)}</dd>
          <dt>Customer</dt><dd>{order.company_name}{order.account_no ? ` · ${order.account_no}` : ""}</dd>
          <dt>Placed by</dt><dd>{order.placed_by_name ?? order.placed_by_email}{order.placed_by_role !== "customer" ? " (AMBIT)" : ""}</dd>
          <dt>Submitted</dt><dd>{dateTime(order.created_at)}</dd>
          <dt>Delivery</dt>
          <dd>{DELIVERY_LABEL[order.delivery_method]}{where}</dd>
          {order.po_number ? (<><dt>PO number</dt><dd>{order.po_number}</dd></>) : null}
          {order.needed_by ? (<><dt>Needed by</dt><dd>{dateShort(order.needed_by)}</dd></>) : null}
          {order.notes ? (<><dt>Notes</dt><dd>{order.notes}</dd></>) : null}
          {state === "approved" ? (
            <>
              <dt>Approved</dt>
              <dd>
                {order.approval_method === "staff_recorded"
                  ? `${order.approval_note ?? ""} (recorded by ${order.approved_by_name ?? "AMBIT"})`
                  : order.approved_by_name ?? ""}
                {"\n"}
                <span className="faint">
                  {dateTime(order.approved_at)}
                  {order.approval_method === "email_link" ? " · from the email link" : order.approval_method === "in_app" ? " · in the app" : ""}
                </span>
              </dd>
            </>
          ) : null}
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

      <div className="grid2">
        <a href={`/orders/${order.id}/pdf`} target="_blank" rel="noopener" className="btn dark sm"><FileDown size={16} /> Order PDF</a>
        <Link href={`/order?reorder=${order.id}`} className="btn dark sm"><RefreshCw size={16} /> Reorder</Link>
      </div>

      {emp ? (
        <section className="section">
          <div className="eyebrow">AMBIT team</div>

          {waiting ? (
            <div className="card col" style={{ gap: 12 }}>
              <div>
                <div className="row between" style={{ gap: 8 }}>
                  <b>{state === "changes_requested" ? "Customer asked for changes" : state === "expired" ? "Approval link expired" : "Waiting for customer approval"}</b>
                  <ApprovalPill order={order} />
                </div>
                {state === "changes_requested" ? (
                  <>
                    <p className="small" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", borderLeft: "3px solid var(--red)", paddingLeft: 10 }}>{order.approval_note}</p>
                    <p className="tiny faint" style={{ margin: "8px 0 0" }}>
                      To fix it, tap Reorder above to start a corrected copy and send that one for approval, then set this order to Cancelled.
                    </p>
                  </>
                ) : (
                  <p className="small muted" style={{ margin: "6px 0 0" }}>
                    {order.approval_email
                      ? `Emailed to ${order.approval_email} ${dateTime(order.approval_sent_at)}. `
                      : "Not emailed yet. "}
                    {order.approval_expires_at
                      ? state === "expired"
                        ? `The link expired ${dateShort(order.approval_expires_at)}. Resend to make a new one.`
                        : `The link works until ${dateShort(order.approval_expires_at)}.`
                      : ""}
                  </p>
                )}
                {order.approval_email_status === "failed" || order.approval_email_status === "not_configured" ? (
                  <div className="alert err small" style={{ marginTop: 10 }}>
                    <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
                    <span>
                      {order.approval_email_status === "not_configured"
                        ? "Email isn't set up, so the customer didn't get it."
                        : `The approval email failed: ${order.approval_email_error ?? "unknown error"}`}
                    </span>
                  </div>
                ) : null}
              </div>

              <form action={resendApproval} className="col" style={{ gap: 8 }}>
                <input type="hidden" name="id" value={order.id} />
                <label className="field">
                  <span className="label">Send the approval email to</span>
                  <input className="input" type="email" name="email" required defaultValue={order.approval_email ?? company?.email ?? ""} />
                </label>
                <Submit className="btn sm" pendingText="Sending…">Resend approval email</Submit>
              </form>

              <details>
                <summary className="linkbtn small">Customer approved by phone or in person?</summary>
                <form action={recordApproval} className="col" style={{ gap: 8, marginTop: 10 }}>
                  <input type="hidden" name="id" value={order.id} />
                  <label className="field">
                    <span className="label">Who approved it, and how</span>
                    <input className="input" name="note" required minLength={5} placeholder={`${company?.contact_name ?? "Travis Holt"} approved by phone, 10:15 AM`} />
                  </label>
                  <p className="tiny faint" style={{ margin: 0 }}>This is printed on the order with your name. The order then goes to orders@ambitpu.com.</p>
                  <Submit className="btn dark sm" pendingText="Saving…">Record approval and send</Submit>
                </form>
              </details>
            </div>
          ) : null}

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

          {waiting ? (
            <div className="alert info small">Goes to orders@ambitpu.com once the customer approves.</div>
          ) : (
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
          )}
        </section>
      ) : null}
    </main>
  );
}
