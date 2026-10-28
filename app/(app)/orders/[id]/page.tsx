import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, CircleAlert, CircleCheck, FileDown, MailCheck, RefreshCw } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { TrackRecent } from "@/components/recent";
import { DELIVERY_LABEL, dateShort, dateTime, money, orderNo, plural, qtyText } from "@/lib/format";
import { foamLoads, foamOf, pickText, rowPrice, splitNote } from "@/lib/order-doc/loads";
import { orderPicks, showsPicks } from "@/lib/order-doc/load";
import type { LotPick } from "@/lib/order-doc/loads";
import { ApprovalPill, StatusPill, TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { cancelOrder, customerDecision, deleteOrder, recordApproval, resendApproval, resendOrderEmail, setOrderStatus } from "@/app/(app)/orders/actions";
import { docState } from "@/lib/order-doc/types";
import { OrderDeskCard, type OrderFile } from "@/components/order-desk-card";
import type { Alternative, LotChoice, Variance, VarianceData } from "@/components/item-variance";
import { can } from "@/lib/access";
import { STAGES, customerProgress, stageOf } from "@/lib/order-desk";
import type { Branch, Company, Order, OrderItem } from "@/lib/types";
import { companyTax } from "@/lib/tax-server";
import { TAX_STATE, taxLine } from "@/lib/tax";

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
  // Everything else about the order, all at once.
  const staffOpen = emp && order.company_id && order.status !== "completed" && order.status !== "cancelled";
  const [{ data: items }, { data: branch }, { data: company }, picks, { data: fileRows }, { data: varRows }, tax, { data: invRows }, { data: rep }] = await Promise.all([
    supabase.from("order_items").select("*, product:products!order_items_product_id_fkey(image_url, category_id)").eq("order_id", id).order("id"),
    order.branch_id ? supabase.from("branches").select("*").eq("id", order.branch_id).maybeSingle<Branch>() : Promise.resolve({ data: null }),
    emp && order.company_id
      ? supabase.from("companies").select("email, contact_name").eq("id", order.company_id).maybeSingle<Pick<Company, "email" | "contact_name">>()
      : Promise.resolve({ data: null }),
    // Staff: which brand and lot the spray foam drums come from.
    emp ? orderPicks(supabase, id) : Promise.resolve(new Map<number, LotPick[]>()),
    emp
      ? supabase.from("order_files").select("id, kind, name, uploaded_by_name, created_at").eq("order_id", id).order("created_at")
      : Promise.resolve({ data: null }),
    emp
      ? supabase.from("order_variances").select("id, order_item_id, kind, from_text, to_text, reason, stage, by_name, created_at").eq("order_id", id).order("created_at")
      : Promise.resolve({ data: null }),
    // Staff: the customer's sales-tax exemption (an expired certificate holds the order at the credit check).
    staffOpen ? companyTax(supabase, order.company_id!) : Promise.resolve(null),
    // Staff: where each line stands on the branch inventory spreadsheet (Oklahoma City first).
    emp
      ? supabase.from("inventory_lines").select("order_item_id, state, sheet_row, sheet_status").eq("order_id", id).or("done_by.is.null,done_by.neq.swap").order("id")
      : Promise.resolve({ data: null }),
    // Staff: the customer's sales rep, who gets credit for the order.
    emp && order.sales_rep_id
      ? supabase.from("profiles").select("full_name, email").eq("id", order.sales_rep_id).maybeSingle<{ full_name: string | null; email: string }>()
      : Promise.resolve({ data: null }),
  ]);
  const lines = (items ?? []) as (OrderItem & { product: { image_url: string | null; category_id: string | null } | null })[];
  const pickFor = (l: OrderItem) => {
    const p = picks.get(l.id);
    return emp && showsPicks(l.sku, p) ? p : undefined;
  };
  // Item variance: admins and the Item variance box can load a different lot or product type.
  const isOpen = order.status !== "completed" && order.status !== "cancelled";
  const canVary = emp && can(profile, "item_variance") && isOpen;
  const choices = new Map<number, LotChoice[]>();
  const alternatives = new Map<number, Alternative[]>();
  if (canVary) {
    const open = lines.flatMap((l) => (picks.get(l.id) ?? []).filter((p) => p.state === "reserved"));
    await Promise.all([
      ...open.map(async (p) => {
        const { data } = await supabase.rpc("inventory_lot_choices", { p_line: p.id });
        choices.set(p.id, ((data ?? []) as LotChoice[]).map((c) => ({ ...c, available: Number(c.available) })));
      }),
      ...lines
        .filter((l) => l.product_id)
        .map(async (l) => {
          const { data } = await supabase.rpc("order_item_alternatives", { p_item: l.id });
          alternatives.set(l.id, ((data ?? []) as Alternative[]).map((a) => ({ ...a, on_hand: a.on_hand === null ? null : Number(a.on_hand), available: a.available === null ? null : Number(a.available) })));
        }),
    ]);
  }
  const files = (fileRows ?? []) as OrderFile[];
  const variance: VarianceData | null = emp
    ? { orderId: order.id, lines, picks, choices, alternatives, log: (varRows ?? []) as Variance[], canEdit: canVary }
    : null;
  // Spray foam grouped by load (ISO with the resin it goes with), like the printed order.
  const groups = foamLoads(lines.map((l) => ({ ...l, foam: foamOf(l, l.product?.category_id), picks: pickFor(l) })));
  const shownStock = new Set<number>();
  const shownVary = new Set<number>();
  const inv = new Map<number, { state: string; sheet_row: number | null }[]>();
  for (const r of (invRows ?? []) as { order_item_id: number; state: string; sheet_row: number | null }[]) inv.set(r.order_item_id, [...(inv.get(r.order_item_id) ?? []), r]);
  const stockNote = (itemId: number) => {
    const rs = inv.get(itemId);
    if (!rs?.length) return null;
    const open = rs.filter((r) => r.state === "reserved");
    if (open.length === rs.length) {
      const at = open.map((r) => r.sheet_row).filter((n): n is number => n !== null);
      return {
        cls: "in",
        text: at.length === open.length
          ? `Reserved on the ${order.branch_id?.toUpperCase()} spreadsheet (PENDING ORDERS ${at.length > 1 ? "rows" : "row"} ${at.join(", ")})`
          : "Reserved · going onto the spreadsheet",
      };
    }
    if (rs.every((r) => r.state === "done")) return { cls: "none", text: "Picked up · taken out of stock" };
    if (rs.every((r) => r.state === "cancelled")) return { cls: "none", text: "Released (cancelled)" };
    return { cls: "in", text: "Partly picked up" };
  };
  const state = docState(order);
  const waiting = state === "pending" || state === "expired" || state === "changes_requested";
  const justSent = sp.sent === "1" || sp.sent === "approval";
  const contractorDecides = !emp && profile.role === "customer" && order.placed_by_role !== "customer" && state === "pending";
  const where = order.delivery_method === "pickup"
    ? `: ${branch ? `${branch.name}, ${branch.state}` : order.branch_id}`
    : `${branch && order.delivery_method === "jobsite" ? ` from ${branch.name}, ${branch.state}` : ""}\n${order.ship_address ?? ""}`;

  return (
    <main className="shell">
      <TrackRecent uid={profile.id} kind="order" href={`/orders/${order.id}`} title={emp ? order.company_name : orderNo(order.order_no)} sub={emp ? orderNo(order.order_no) : "Order"} />
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
          right={
            emp && stageOf(order) ? (
              <span className={STAGES[stageOf(order)!].pill}>{STAGES[stageOf(order)!].short}</span>
            ) : waiting ? (
              <ApprovalPill order={order} />
            ) : (
              <StatusPill status={order.status} />
            )
          }
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
          {emp ? (
            <>
              <dt>Sales rep</dt>
              <dd>{rep ? rep.full_name?.trim() || rep.email : <span className="faint">None yet. Set the customer&apos;s rep in Admin → Customers.</span>}</dd>
            </>
          ) : null}
          <dt>Submitted</dt><dd>{dateTime(order.created_at)}</dd>
          <dt>Delivery</dt>
          <dd>{DELIVERY_LABEL[order.delivery_method]}{where}</dd>
          {order.po_number ? (<><dt>PO number</dt><dd>{order.po_number}</dd></>) : null}
          {order.needed_by ? (<><dt>Needed by</dt><dd>{dateShort(order.needed_by)}</dd></>) : null}
          {order.notes ? (<><dt>Notes</dt><dd>{order.notes}</dd></>) : null}
          {!emp && customerProgress(order) ? (<><dt>Status</dt><dd>{customerProgress(order)}</dd></>) : null}
          {order.scheduled_for && stageOf(order) !== "cancelled" ? (
            <><dt>{order.delivery_method === "pickup" ? "Pickup" : "Delivery"}</dt><dd>{dateShort(order.scheduled_for)}{order.schedule_note ? `\n${order.schedule_note}` : ""}</dd></>
          ) : null}
          {emp && order.ambit_po ? (<><dt>Sales Order #</dt><dd>{order.ambit_po}</dd></>) : null}
          {emp && order.invoice_no ? (<><dt>Invoice #</dt><dd>{order.invoice_no}</dd></>) : null}
          {emp && order.tax_note ? (<><dt>Sales tax</dt><dd style={{ color: "var(--warn-text)", fontWeight: 700 }}>{order.tax_note}</dd></>) : null}
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

      {emp && tax && (TAX_STATE[tax.state].blocks || tax.state === "expiring") ? (
        <div className={`alert ${TAX_STATE[tax.state].blocks ? "err" : "warn"} small`} role="status">
          <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
          <span>
            {taxLine(tax, dateShort)}.{TAX_STATE[tax.state].blocks ? " Accounting can't release this order until a current certificate is verified, or they choose to charge sales tax." : ""}
            {can(profile, "credit_check") && order.company_id ? <> <Link href={`/tax/${order.company_id}`}>Tax certificates</Link></> : null}
          </span>
        </div>
      ) : null}
      {emp ? (
        <OrderDeskCard
          order={order}
          desk={can(profile, "order_desk")}
          credit={can(profile, "credit_check")}
          warehouse={can(profile, "inventory")}
          tax={tax}
          files={files}
          variance={variance}
          lines={lines.map((l) => ({ ...l, foam: foamOf(l, l.product?.category_id) }))}
        />
      ) : null}

      <section className="section">
        <div className="eyebrow">{lines.length} {lines.length === 1 ? "item" : "items"}</div>
        <div className="list">
          {groups.flatMap((g, gi) =>
            g.rows.map((row, ri) => {
              const l = row.item;
              const note = splitNote(row, plural(l.unit, 2));
              const stock = shownStock.has(l.id) ? null : stockNote(l.id);
              shownStock.add(l.id);
              return (
                <div key={`${l.id}-${gi}-${ri}`} className={`product${gi > 0 && ri === 0 ? " load-break" : ""}`}>
                  {l.product?.image_url ? <img className="thumb sm" src={l.product.image_url} alt="" loading="lazy" /> : null}
                  <div className="grow">
                    <div className="name">{l.name}</div>
                    <div className="desc">{l.sku} · {qtyText(row.qty, l.unit)}</div>
                    {note ? <div className="tiny faint">{note}</div> : null}
                    {stock ? <div className={`stock-tag ${stock.cls}`}>{stock.text}</div> : null}
                    {emp && l.ordered_sku && !shownVary.has(l.id) && shownVary.add(l.id) ? (
                      <div className="stock-tag vary">Loading this instead of {l.ordered_name} ({l.ordered_sku})</div>
                    ) : null}
                    {row.picks?.length ? (
                      <div className="picks">
                        {row.picks.map((p, pi) => (
                          <div key={`${p.id}-${pi}`} className="pick">
                            <span><b>{qtyText(p.qty, l.unit)}</b> {pickText(p)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {l.customer_priced && l.unit_price === null ? (
                      <span className="cp-tag">Customer pricing</span>
                    ) : l.line_total !== null ? (
                      <>
                        <div style={{ fontWeight: 800 }}>{money(rowPrice(l, row).total)}</div>
                        <div className="tiny faint">{money(rowPrice(l, row).each)} / {l.unit}</div>
                      </>
                    ) : (
                      <span className="tiny faint">On invoice</span>
                    )}
                  </div>
                </div>
              );
            }),
          )}
          <div className="row between" style={{ padding: "14px 16px" }}>
            <span className="muted small">{order.priced_at ? "Subtotal (invoice prices)" : "Estimated list-price subtotal"}</span>
            <b>{money(order.est_subtotal)}</b>
          </div>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Final pricing, tax and freight are confirmed by AMBIT on the invoice.</p>
      </section>

      <div className="grid2">
        <a href={`/orders/${order.id}/pdf`} target="_blank" rel="noopener" className="btn dark sm"><FileDown size={16} /> {lines.some((l) => pickFor(l)) ? "Warehouse PDF" : "Order PDF"}</a>
        <Link href={`/order?reorder=${order.id}`} className="btn dark sm"><RefreshCw size={16} /> Reorder</Link>
      </div>
      {lines.some((l) => pickFor(l)) ? (
        <p className="tiny faint" style={{ margin: "-6px 0 0", textAlign: "center" }}>
          The warehouse PDF shows brands and lots (AMBIT only). <a href={`/orders/${order.id}/pdf?copy=customer`} target="_blank" rel="noopener">Customer copy</a> leaves them out.
        </p>
      ) : null}

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

          {profile.role === "admin" || can(profile, "order_desk") ? (
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
          ) : null}

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

      {/* Cancel (admins, the order desk, or whoever placed it until it has a Sales Order #) and delete (admins). */}
      {emp && order.status !== "cancelled" && order.status !== "completed" &&
      (profile.role === "admin" || can(profile, "order_desk") || (order.placed_by === profile.id && !order.ambit_po)) ? (
        <section className="section">
          <details className="danger-zone">
            <summary>Cancel this order</summary>
            <form action={cancelOrder} className="col" style={{ gap: 10, marginTop: 10 }}>
              <input type="hidden" name="id" value={order.id} />
              <label className="field">
                <span className="label">Why is it cancelled?</span>
                <input className="input" name="reason" required minLength={3} maxLength={500} placeholder="Customer called to cancel / Entered twice / Test order" />
              </label>
              <p className="tiny faint" style={{ margin: 0 }}>
                Its stock is released and the line on the inventory sheet is marked Cancelled. The order stays in the Orders list as Cancelled{profile.role === "admin" ? ", and you can delete it after that" : ""}.
              </p>
              <Submit className="btn sm danger" pendingText="Cancelling…">Cancel order</Submit>
            </form>
          </details>
        </section>
      ) : null}
      {order.status === "cancelled" ? (
        <section className="section">
          <div className="alert warn small">
            <span>
              <b>Cancelled</b>
              {order.cancelled_by_name ? ` by ${order.cancelled_by_name}` : ""}
              {order.cancelled_at ? ` · ${dateTime(order.cancelled_at)}` : ""}
              {order.cancel_reason ? ` · ${order.cancel_reason}` : ""}
            </span>
          </div>
          {profile.role === "admin" ? (
            <details className="danger-zone">
              <summary>Delete this order for good</summary>
              <form action={deleteOrder} className="col" style={{ gap: 10, marginTop: 10 }}>
                <input type="hidden" name="id" value={order.id} />
                <label className="check small">
                  <input type="checkbox" name="sure" /> I understand {orderNo(order.order_no)} and its items are removed from the app permanently. This can&apos;t be undone.
                </label>
                <Submit className="btn sm danger" pendingText="Deleting…">Delete order</Submit>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
