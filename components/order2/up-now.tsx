import Link from "next/link";
import { CircleAlert, CircleCheck, FileText, Image as ImageIcon, MailX, PenLine, Printer } from "lucide-react";
import { Submit } from "@/components/forms";
import { Help } from "@/components/help";
import { ClosedDateInput } from "@/components/holiday";
import { CompleteForm, NumbersForm } from "@/components/order-file-forms";
import { PayBoxes } from "@/components/pay-boxes";
import type { LotLine } from "@/components/lot-check";
import type { OrderFile } from "@/components/order-desk-card";
import {
  approveOrderChange,
  approveWithoutEmail,
  creditDecision,
  notifyOverride,
  payWaiting,
  recordApproval,
  resendApproval,
  resendScheduledEmail,
  scheduleOrder,
} from "@/app/(app)/orders/actions";
import { dateShort, dateTime, money } from "@/lib/format";
import { changesText, type OrderEdit } from "@/lib/order-edit";
import { docState } from "@/lib/order-doc/types";
import { priceLines, type FoamSide, type PricePart } from "@/lib/order-doc/loads";
import { TAX_STATE, taxLine, type TaxInfo } from "@/lib/tax";
import type { Order, OrderItem, OrderStage } from "@/lib/types";

export type CreditInfo = { limit: number | null; balance: number; pastDue: number; over90: number; available: number | null; lastPaid: string | null; lastPaidAmount: number | null; asOf: string | null; companyId: string };

type Props = {
  order: Order;
  stage: OrderStage | null;
  who: { admin: boolean; desk: boolean; credit: boolean; warehouse: boolean };
  edits: OrderEdit[];
  waitingEdits: OrderEdit[];
  files: OrderFile[];
  lines: (OrderItem & { foam?: FoamSide; price_parts?: PricePart[] | null })[];
  /** "32 drums" — what goes on the truck. */
  loadText: string;
  branchName: string | null;
  tax: TaxInfo | null;
  closures: { date: string; name: string }[];
  creditInfo: CreditInfo | null;
  payDefaults: { cod: boolean; noChecks: boolean } | null;
  pickupLots: LotLine[];
  customerEmail: string | null;
  customerContact: string | null;
  bolProblems: { text: string; tone: string }[];
};

/** Little file chips (invoice pages, signed BOL pages). */
export function FileChips({ orderId, files, label }: { orderId: string; files: OrderFile[]; label: string }) {
  if (!files.length) return null;
  return (
    <span className="lots2">
      {files.map((f, i) => (
        <a key={f.id} href={`/orders/${orderId}/file/${f.id}`} className="lot2" title={`${f.uploaded_by_name ?? ""} · ${dateTime(f.created_at)}`}>
          {/\.pdf$/i.test(f.name ?? "") ? <FileText size={13} /> : <ImageIcon size={13} />}
          {label}{files.length > 1 ? ` ${i + 1}` : ""}
        </a>
      ))}
    </span>
  );
}

function Card({ tone, who, title, sub, pills, children }: { tone: "act" | "wait" | "done"; who: string; title: React.ReactNode; sub?: React.ReactNode; pills?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className={`up2${tone === "wait" ? " wait" : tone === "done" ? " done" : ""}`} aria-label="Up now">
      <div className="up2-top">
        <div className="up2-txt">
          <span className="up2-who">{who}</span>
          <span className="up2-title">{title}</span>
          {sub ? <span className="up2-sub">{sub}</span> : null}
        </div>
        {pills ? <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{pills}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** The one card that says what happens next on this order, and gives whoever's job it is the button to do it. */
export function UpNow(p: Props) {
  const o = p.order;
  const st = p.stage;
  const pickup = o.delivery_method === "pickup";
  const dropship = o.delivery_method === "dropship";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const invoices = p.files.filter((f) => f.kind === "invoice");
  const bols = p.files.filter((f) => f.kind === "bol");
  const paid = Boolean(o.pay_prepaid);
  const payFlags = paid ? [] : ([o.pay_cod ? "COD only" : null, o.pay_no_checks ? "No checks" : null].filter(Boolean) as string[]);
  const waitingPay = Boolean(o.pay_waiting_at) && o.credit_status !== "approved";
  const pills = (
    <>
      {paid ? <span className="pill2 ok">Paid</span> : null}
      {waitingPay ? <span className="pill2 warn">Waiting on payment</span> : null}
      {payFlags.map((f) => <span key={f} className="pill2 err">{f}</span>)}
    </>
  );
  const anyPill = paid || waitingPay || payFlags.length > 0;
  const changeList = (list: OrderEdit[]) => (
    <ul className="edit-changes small" style={{ margin: 0 }}>
      {list.flatMap((e) => changesText(e.changes).map((t, i) => <li key={`${e.id}-${i}`}>{t}</li>))}
    </ul>
  );

  // ---------------------------------------------------------------- cancelled
  if (o.status === "cancelled" || st === "cancelled") {
    return (
      <Card
        tone="wait"
        who="Cancelled"
        title={o.cancel_reason ?? "This order was cancelled"}
        sub={[o.cancelled_by_name, o.cancelled_at ? dateTime(o.cancelled_at) : null].filter(Boolean).join(" · ")}
      />
    );
  }

  // ---------------------------------------------------------------- a change nobody has approved yet (0075)
  if (p.waitingEdits.length) {
    return p.who.admin ? (
      <Card tone="act" who="Up now · Admin" title="Approve the change" sub={o.status === "completed" ? "Corrected after it went out. Make sure the QuickBooks invoice matches." : "Nobody can load it until you approve."}>
        {changeList(p.waitingEdits)}
        <form action={approveOrderChange} className="col" style={{ gap: 10 }}>
          <input type="hidden" name="id" value={o.id} />
          <label className="check small">
            <input type="checkbox" name="invoice_ok" value="1" required /> The QuickBooks invoice matches{o.invoice_no ? ` (Invoice # ${o.invoice_no})` : ""}
          </label>
          <input className="input sm" name="note" maxLength={500} placeholder="Note (optional)" aria-label="Note" />
          <div className="up2-acts"><Submit className="b2" pendingText="Approving…">Approve the change</Submit></div>
        </form>
      </Card>
    ) : (
      <Card tone="wait" who="Waiting on an admin" title="Changed · don't load it yet" sub={p.waitingEdits.some((e) => e.admin_email_status === "sent") ? "Admins were emailed." : "The email to admins didn't go out, so tell an admin."}>
        {changeList(p.waitingEdits)}
      </Card>
    );
  }

  // ---------------------------------------------------------------- gone out
  if (o.status === "completed") {
    if (st === "invoice_update" && p.who.desk) {
      return (
        <Card tone="act" who="Up now · Order desk" title="Update the invoice" sub="Corrected after it went out. Enter the new Invoice # and prices.">
          {changeList(p.edits.filter((e) => !e.invoice_updated_at))}
          <NumbersForm orderId={o.id} po={o.ambit_po ?? null} invoice={o.invoice_no ?? null} lines={priceLines(p.lines, { prefill: false })} />
        </Card>
      );
    }
    return (
      <Card
        tone={p.bolProblems.length ? "wait" : "done"}
        who={p.bolProblems.length ? "Check the signed BOL" : "Done"}
        title={`${pickup ? "Picked up" : dropship ? "Shipped" : "Delivered"}${o.completed_at ? ` ${dateShort(o.completed_at.slice(0, 10))}` : ""}`}
        sub={paid ? "Customer had already paid" : payFlags.length ? payFlags.join(" · ") : undefined}
      >
        {bols.length ? <FileChips orderId={o.id} files={bols} label="Signed BOL" /> : <span className="up2-sub">No signed BOL attached.</span>}
        {p.bolProblems.length ? (
          <div className={`alert ${p.bolProblems.some((x) => x.tone === "err") ? "err" : "warn"} small col`} role="alert" style={{ alignItems: "stretch", gap: 4 }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{p.bolProblems.map((x, i) => <li key={i}>{x.text}</li>)}</ul>
            <span className="row" style={{ gap: 14, flexWrap: "wrap" }}>
              <Link href={`/orders/${o.id}?do=files`}>Fix the files</Link>
              {p.who.admin ? <Link href={`/orders/bol-review?o=${o.order_no}`}>BOL review</Link> : <span className="tiny">AI wrong? Tell an admin.</span>}
            </span>
          </div>
        ) : null}
      </Card>
    );
  }

  // ---------------------------------------------------------------- with the customer
  if (st === "customer") {
    const state = docState(o);
    const failed = o.approval_email_status === "failed" || o.approval_email_status === "not_configured";
    return (
      <Card
        tone="wait"
        who="Waiting on the customer"
        title={state === "changes_requested" ? `${o.company_name} asked for changes` : state === "expired" ? "The approval link expired" : `Waiting for ${o.company_name} to approve`}
        sub={
          state === "changes_requested"
            ? undefined
            : `${o.approval_email ? `Emailed to ${o.approval_email} ${dateTime(o.approval_sent_at)}` : "Not emailed yet"}${o.approval_expires_at && state !== "expired" ? ` · link works until ${dateShort(o.approval_expires_at)}` : ""}`
        }
      >
        {state === "changes_requested" && o.approval_note ? (
          <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap", borderLeft: "3px solid var(--red)", paddingLeft: 10 }}>{o.approval_note}</p>
        ) : null}
        {failed ? (
          <div className="alert err small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{o.approval_email_status === "not_configured" ? "Email isn't set up, so the customer didn't get it." : `The email failed: ${o.approval_email_error ?? "unknown error"}`}</span></div>
        ) : null}
        <form action={resendApproval} className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={o.id} />
          <input className="input" type="email" name="email" required defaultValue={o.approval_email ?? p.customerEmail ?? ""} aria-label="Customer email" style={{ flex: "1 1 220px" }} />
          <Submit className="b2" pendingText="Sending…">{o.approval_email ? "Resend" : "Send"}</Submit>
        </form>
        <div className="up2-more">
          <details>
            <summary>Approved by phone?</summary>
            <form action={recordApproval} className="col" style={{ gap: 8, marginTop: 10 }}>
              <input type="hidden" name="id" value={o.id} />
              <input className="input" name="note" required minLength={5} aria-label="Who approved it, and how" placeholder={`${p.customerContact ?? "Travis Holt"} approved by phone, 10:15 AM`} />
              <div className="row" style={{ gap: 8 }}>
                <Submit className="b2 sm" pendingText="Saving…">Record it</Submit>
                <Help>Printed on the order with your name. The order then goes to orders@ambitpu.com.</Help>
              </div>
            </form>
          </details>
          <form action={approveWithoutEmail}>
            <input type="hidden" name="id" value={o.id} />
            <Submit className="link2" pendingText="Saving…"><span style={{ color: "var(--text2)" }}>Approve without email</span></Submit>
          </form>
        </div>
      </Card>
    );
  }

  // ---------------------------------------------------------------- Invoice # and prices (no more Sales Order #, 0121)
  if (st === "needs_po" || st === "invoice_update") {
    const edited = st === "invoice_update";
    const pending = p.edits.filter((e) => !e.invoice_updated_at && e.stage_before && !["customer", "needs_po"].includes(e.stage_before));
    return p.who.desk ? (
      <Card
        tone="act"
        who="Up now · Order desk"
        title={edited ? "Update the invoice" : "Invoice # & prices"}
        sub={edited ? `Edited by ${o.invoice_update_by_name ?? "AMBIT staff"} · ${dateTime(o.invoice_update_at)}` : undefined}
        pills={invoices.length ? <FileChips orderId={o.id} files={invoices} label="Invoice" /> : undefined}
      >
        {edited && pending.length ? changeList(pending) : null}
        <NumbersForm orderId={o.id} po={o.ambit_po ?? null} invoice={o.invoice_no ?? null} lines={priceLines(p.lines, { prefill: !edited && !o.priced_at })} />
      </Card>
    ) : (
      <Card tone="wait" who="Waiting on the order desk" title={edited ? "Invoice update (order was edited)" : "Invoice # & prices"} />
    );
  }

  // ---------------------------------------------------------------- credit check
  if (st === "credit" || st === "hold") {
    const hold = st === "hold";
    const autoNote = (o as typeof o & { credit_auto_note?: string | null }).credit_auto_note;
    const taxBlocks = Boolean(p.tax && TAX_STATE[p.tax.state].blocks);
    if (!p.who.credit) {
      return <Card tone="wait" who="Waiting on accounting" title={hold ? "On credit hold" : "Credit check"} sub={hold ? o.credit_note ?? undefined : undefined} pills={anyPill ? pills : undefined} />;
    }
    const c = p.creditInfo;
    const payStart = { cod: Boolean(o.pay_cod || p.payDefaults?.cod), noChecks: Boolean(o.pay_no_checks || p.payDefaults?.noChecks), prepaid: paid || waitingPay };
    return (
      <Card
        tone="act"
        who="Up now · Accounting"
        title={hold ? "On credit hold" : /^Check again/.test(o.credit_note ?? "") ? o.credit_note! : "Check credit and release"}
        sub={hold ? `${o.credit_note ?? ""} · ${o.credit_by_name ?? ""}` : autoNote ? `Didn't release automatically: ${autoNote}` : undefined}
        pills={anyPill ? pills : undefined}
      >
        {c ? (
          <div className="col" style={{ gap: 6 }}>
            <span className="credit-snap" style={{ marginTop: 0 }}>
              <span><span className="tiny faint">Credit line</span><b>{c.limit !== null ? money(c.limit) : "–"}</b></span>
              <span><span className="tiny faint">Owes</span><b>{money(c.balance)}</b></span>
              <span><span className="tiny faint">Past due</span><b className={c.pastDue ? "red" : ""}>{c.pastDue ? money(c.pastDue) : "–"}</b></span>
              <span><span className="tiny faint">Available</span><b className={c.available !== null && c.available < 0 ? "red" : ""}>{c.available !== null ? money(c.available) : "–"}</b></span>
            </span>
            <span className="tiny faint">
              {c.lastPaid ? `Last paid ${dateShort(c.lastPaid)}${c.lastPaidAmount ? ` (${money(c.lastPaidAmount)})` : ""}` : "No payment entered"}
              {" · "}<a href={`/customers/${c.companyId}?pay=1`}>Record a payment</a> · <a href={`/customers/${c.companyId}`}>Customer</a>
            </span>
          </div>
        ) : null}
        <form action={creditDecision} className="col" style={{ gap: 10 }}>
          <input type="hidden" name="id" value={o.id} />
          <input type="hidden" name="decision" value="approve" />
          {taxBlocks && p.tax ? (
            <>
              <span className="small" style={{ color: "var(--err-text)", fontWeight: 700 }}>{taxLine(p.tax, dateShort)}.</span>
              <label className="check small"><input type="checkbox" name="charge_tax" /> Charge sales tax on this order instead</label>
            </>
          ) : null}
          <PayBoxes start={payStart} remembered={Boolean(p.payDefaults && (p.payDefaults.cod || p.payDefaults.noChecks) && !o.pay_cod && !o.pay_no_checks)} />
          <div className="up2-acts">
            <Submit className="b2 lg" pendingText="Releasing…">Release order</Submit>
            <Help>Check the account for credit holds first. Releasing hands the order to the order desk to schedule.</Help>
          </div>
        </form>
        <div className="up2-more">
          {!hold ? (
            <form action={payWaiting}>
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="on" value={waitingPay ? "0" : "1"} />
              <Submit className="link2" pendingText="Saving…"><span style={{ color: "var(--text2)" }}>{waitingPay ? "Payment's in" : "Waiting on payment"}</span></Submit>
            </form>
          ) : null}
          {!hold ? (
            <details>
              <summary>Put on hold</summary>
              <form action={creditDecision} className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="decision" value="hold" />
                <input className="input sm" name="note" required placeholder="Why: past due 60 days" aria-label="Why" style={{ flex: "1 1 200px" }} />
                <Submit className="b2 sm quiet" pendingText="Saving…">Put on hold</Submit>
              </form>
            </details>
          ) : null}
        </div>
      </Card>
    );
  }

  // ---------------------------------------------------------------- set the date
  if (st === "schedule") {
    return p.who.desk ? (
      <Card tone="act" who="Up now · Order desk" title={`Set the ${pickup ? "pickup" : "delivery"} date`} sub={o.needed_by ? `Needed by ${dateShort(o.needed_by)}` : undefined} pills={anyPill ? pills : undefined}>
        <ScheduleForm o={o} today={today} closures={p.closures} />
      </Card>
    ) : (
      <Card tone="wait" who="Waiting on the order desk" title={`Needs a ${pickup ? "pickup" : "delivery"} date`} pills={anyPill ? pills : undefined} />
    );
  }

  // ---------------------------------------------------------------- load it, sign it
  if (st === "scheduled") {
    const when = o.scheduled_for ? `${pickup ? "Pickup" : dropship ? "Ships" : "Truck"} ${o.scheduled_for === today ? "today" : dateShort(o.scheduled_for)}` : "";
    const sub = [when, o.schedule_note].filter(Boolean).join(" · ");
    const notified = !o.notify_status || o.notify_status === "sent" || o.notify_status === "override";
    const closer = p.who.desk || p.who.warehouse;
    if (!closer) return <Card tone="wait" who="Scheduled" title={when || "Scheduled"} sub={o.schedule_note ?? undefined} pills={anyPill ? pills : undefined} />;
    return (
      <Card
        tone="act"
        who={`Up now · Warehouse${p.branchName && !dropship ? `, ${p.branchName}` : ""}`}
        title={dropship ? "Mark it shipped" : `Load ${p.loadText} and get it signed`}
        sub={sub || undefined}
        pills={anyPill ? pills : undefined}
      >
        {o.pay_cod && !paid ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>Collect payment before it {pickup ? "leaves" : "is unloaded"}{o.pay_no_checks ? ". Cash or card only." : "."}</span></div> : null}
        {!o.pay_cod && o.pay_no_checks && !paid ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>Don&apos;t take a check: cash or card only.</span></div> : null}
        {paid ? <div className="alert ok small" role="status"><CircleCheck size={16} style={{ flex: "none", marginTop: 2 }} /><span>Already paid. Nothing to collect.</span></div> : null}
        {p.bolProblems.some((x) => x.tone === "err") ? (
          <div className="alert err small col" role="alert" style={{ alignItems: "stretch", gap: 4 }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{p.bolProblems.filter((x) => x.tone === "err").map((x, i) => <li key={i}>{x.text}</li>)}</ul>
            <Link href={`/orders/${o.id}?do=files`}>Fix the files</Link>
          </div>
        ) : null}
        {dropship ? (
          <CompleteForm orderId={o.id} pickup={pickup} hasBol={bols.length > 0} lots={p.pickupLots} />
        ) : (
          <>
            <div className="up2-acts">
              <Link href={`/orders/${o.id}/sign`} className="b2 lg"><PenLine size={19} /> Load &amp; sign</Link>
              <a href={`/orders/${o.id}/packing-slip`} target="_blank" rel="noopener" className="b2 lg quiet icon" aria-label="Print packing slip" title="Print packing slip"><Printer size={19} /></a>
              <Help>Both sign with a finger. It&apos;s marked {pickup ? "picked up" : "shipped out"} and the signed slip is saved as the BOL.</Help>
            </div>
            <div className="up2-more">
              <details>
                <summary>Signed on paper?</summary>
                <div style={{ marginTop: 10 }}>
                  <CompleteForm orderId={o.id} pickup={pickup} hasBol={bols.length > 0} lots={p.pickupLots} />
                </div>
              </details>
              {p.who.desk && !notified ? (
                <>
                  {o.notify_status !== "not_configured" ? (
                    <form action={resendScheduledEmail}>
                      <input type="hidden" name="id" value={o.id} />
                      <Submit className="link2" pendingText="Sending…"><span style={{ color: "var(--text2)" }}>Resend customer email</span></Submit>
                    </form>
                  ) : null}
                  <form action={notifyOverride}>
                    <input type="hidden" name="id" value={o.id} />
                    <Submit className="link2" pendingText="Saving…"><span style={{ color: "var(--text2)" }}><MailX size={14} style={{ verticalAlign: -2 }} /> Customer OK without email</span></Submit>
                  </form>
                </>
              ) : null}
            </div>
          </>
        )}
      </Card>
    );
  }
  return null;
}

/** Set or change the pickup / delivery date (the customer is emailed). */
export function ScheduleForm({ o, today, closures }: { o: Order; today: string; closures: { date: string; name: string }[] }) {
  return (
    <form action={scheduleOrder} className="col" style={{ gap: 10 }}>
      <input type="hidden" name="id" value={o.id} />
      <div className="grid2">
        <ClosedDateInput name="date" min={today} defaultValue={o.scheduled_for ?? o.needed_by ?? ""} closures={closures} />
        <input className="input sm" name="note" defaultValue={o.schedule_note ?? ""} placeholder="Note for the customer" aria-label="Note for the customer" />
      </div>
      <div className="up2-acts">
        <Submit className="b2" pendingText="Saving…">{o.scheduled_for ? "Change date" : "Schedule"}</Submit>
        <Help>The customer gets an email with the date.</Help>
      </div>
    </form>
  );
}
