import { Check, CircleAlert, FileText, Image as ImageIcon, MailX } from "lucide-react";
import { Submit } from "@/components/forms";
import { approveWithoutEmail, creditDecision, notifyOverride, resendScheduledEmail, scheduleOrder } from "@/app/(app)/orders/actions";
import { CompleteForm, NumbersForm } from "@/components/order-file-forms";
import { ItemVariance, VarianceLog, type VarianceData } from "@/components/item-variance";
import { dateShort, dateTime, money } from "@/lib/format";
import { STAGES, stageOf } from "@/lib/order-desk";
import type { Order, OrderItem } from "@/lib/types";
import { priceLines, type FoamSide, type LastPrices, type PricePart } from "@/lib/order-doc/loads";
import { TAX_STATE, taxLine, type TaxInfo } from "@/lib/tax";

type Step = {
  key: string;
  title: string;
  done: boolean;
  current: boolean;
  /** Shown whether or not this is the step being worked on (for example the variance table). */
  open?: boolean;
  check?: boolean;
  detail?: React.ReactNode;
  extra?: React.ReactNode;
  action?: React.ReactNode;
};

export type OrderFile = { id: number; kind: "invoice" | "bol"; name: string | null; uploaded_by_name: string | null; created_at: string };

/** Links to an order's invoices or signed BOL pages (opened through the app, AMBIT staff only). */
function FileLinks({ orderId, files, label }: { orderId: string; files: OrderFile[]; label: string }) {
  if (!files.length) return null;
  return (
    <div className="file-links">
      <span className="tiny muted">{label}:</span>
      {files.map((f, i) => (
        <a key={f.id} href={`/orders/${orderId}/files/${f.id}`} target="_blank" rel="noopener" className="file-link" title={`${f.uploaded_by_name ?? ""} · ${dateTime(f.created_at)}`}>
          {/\.pdf$/i.test(f.name ?? "") ? <FileText size={14} /> : <ImageIcon size={14} />}
          {files.length > 1 ? `Page ${i + 1}` : "View"}
        </a>
      ))}
    </div>
  );
}

/** Staff view of where the order is and the next step, for whoever's job it is. */
export function OrderDeskCard({
  order,
  desk,
  credit,
  warehouse,
  tax,
  files = [],
  variance,
  lines = [],
  lastPrices = null,
  payDefaults = null,
}: {
  order: Order;
  /** The order's lines, with spray foam marked (ISO or resin) so ISO can be priced per foam set. */
  lines?: (OrderItem & { foam?: FoamSide; price_parts?: PricePart[] | null })[];
  /** The customer's prices on their orders in the last 30 days (the price step starts from them). */
  lastPrices?: LastPrices | null;
  /** The customer's COD Only / No Checks Allowed from their last release (the boxes start that way). */
  payDefaults?: { cod: boolean; noChecks: boolean } | null;
  desk: boolean;
  credit: boolean;
  warehouse: boolean;
  tax?: TaxInfo | null;
  files?: OrderFile[];
  variance?: VarianceData | null;
}) {
  const st = stageOf(order);
  if (!st || st === "cancelled") return null;
  const o = order;
  const pickup = o.delivery_method === "pickup";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const contractor = o.placed_by_role === "customer";
  const invoices = files.filter((f) => f.kind === "invoice");
  const bols = files.filter((f) => f.kind === "bol");
  const open = st !== "completed";
  // The item variance table sits before the Sales Order # step until that's saved, then before Delivered.
  const varyNow: "before_po" | "before_done" | null = !variance || !open || st === "customer" ? null : o.ambit_po ? "before_done" : "before_po";
  // Changes made before the Sales Order # was saved show on the first check; later ones on the final check.
  const early = (v: { stage: string | null }) => !v.stage || v.stage === "customer" || v.stage === "needs_po";
  const log1 = (variance?.log ?? []).filter(early);
  const log2 = (variance?.log ?? []).filter((v) => !early(v));
  const noChanges = <span className="tiny muted">No changes: loading what was picked.</span>;
  // Payment rules accounting set at the release, for the warehouse at pickup / delivery.
  const payFlags = [o.pay_cod ? "COD ONLY" : null, o.pay_no_checks ? "NO CHECKS ALLOWED" : null].filter(Boolean) as string[];
  const payAlert = payFlags.length ? (
    <div className="alert err pay-alert" role="alert">
      <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
      <span>
        <b>{payFlags.join(" · ")}</b>
        <br />
        {o.pay_cod ? `Collect payment before the order ${pickup ? "leaves the warehouse" : "is unloaded"}.` : ""}
        {o.pay_cod && o.pay_no_checks ? " " : ""}
        {o.pay_no_checks ? "Don't accept a check: cash or card only." : ""}
      </span>
    </div>
  ) : null;
  const payStart = { cod: Boolean(o.pay_cod || payDefaults?.cod), noChecks: Boolean(o.pay_no_checks || payDefaults?.noChecks) };
  // Until email is set up: approve / confirm without it.
  const noEmail = (action: (f: FormData) => Promise<void>) => (
    <form action={action}>
      <input type="hidden" name="id" value={o.id} />
      <Submit className="btn sm amber" pendingText="Saving…">
        <MailX size={15} /> Customer Approved without Email
      </Submit>
    </form>
  );

  const steps: Step[] = [
    {
      key: "customer",
      title: contractor ? "Placed and approved by the customer" : "Customer approval",
      done: st !== "customer",
      current: st === "customer",
      detail:
        st === "customer"
          ? o.approval_email_status === "sent"
            ? "Waiting for the customer to approve the emailed order."
            : "Waiting on the customer. The approval email didn't go out (email isn't set up yet)."
          : o.approved_at
            ? `${o.approval_method === "staff_recorded" && o.approval_note ? `${o.approval_note} · recorded by ` : ""}${o.approved_by_name ?? ""} · ${dateTime(o.approved_at)}`
            : o.approval_status === "not_required"
              ? "Not needed for this order"
              : null,
      action: st === "customer" && o.approval_email_status !== "sent" ? noEmail(approveWithoutEmail) : null,
    },
    {
      key: "vary1",
      title: "Item variance check",
      check: true,
      done: Boolean(o.ambit_po),
      current: false,
      open: Boolean(variance),
      detail: variance && st !== "customer" ? (log1.length ? <VarianceLog log={log1} /> : noChanges) : null,
      extra:
        variance?.canEdit && varyNow === "before_po" ? (
          <ItemVariance data={variance} open={st === "needs_po"} title="Item variance table" />
        ) : null,
    },
    {
      key: "po",
      title: "Sales Order #, Invoice # & prices",
      done: Boolean(o.ambit_po),
      current: st === "needs_po",
      detail: o.ambit_po ? (
        <>
          Sales Order # <b>{o.ambit_po}</b> · Invoice # <b>{o.invoice_no ?? "not entered"}</b> · {o.po_by_name} · {dateTime(o.po_at)}
          {o.priced_at ? <><br />Invoice prices entered: <b>{money(o.est_subtotal)}</b> · {o.priced_by_name}</> : <><br /><span className="faint">Prices not entered yet.</span></>}
        </>
      ) : null,
      extra: invoices.length ? <FileLinks orderId={o.id} files={invoices} label={invoices.length > 1 ? "Invoice files" : "Invoice"} /> : null,
      action:
        desk && st !== "customer" && st !== "completed" ? <NumbersForm
            orderId={o.id}
            po={o.ambit_po ?? null}
            invoice={o.invoice_no ?? null}
            lines={priceLines(lines, { last: lastPrices, prefill: !o.priced_at })}
          /> : null,
    },
    {
      key: "credit",
      title: "Credit check",
      done: o.credit_status === "approved",
      current: st === "credit" || st === "hold",
      detail:
        o.credit_status === "approved" ? (
          <>
            {`Released by ${o.credit_by_name ?? ""} · ${dateTime(o.credit_at)}${o.credit_note ? ` · ${o.credit_note}` : ""}`}
            {payFlags.length ? <> · <b className="red">{payFlags.join(" · ")}</b></> : null}
          </>
        ) : o.credit_status === "hold" ? (
          <span className="red">On hold: {o.credit_note} ({o.credit_by_name}, {dateTime(o.credit_at)})</span>
        ) : st === "credit" ? (
          "Waiting on accounting."
        ) : null,
      action:
        credit && (st === "credit" || st === "hold") ? (
          <div className="col" style={{ gap: 8 }}>
            <form action={creditDecision} className="col" style={{ gap: 6 }}>
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="decision" value="approve" />
              {tax && TAX_STATE[tax.state].blocks ? (
                <>
                  <span className="small" style={{ color: "var(--err-text)", fontWeight: 700 }}>{taxLine(tax, dateShort)}. Verify a current certificate under Tax certificates first, or:</span>
                  <label className="check small">
                    <input type="checkbox" name="charge_tax" /> Charge sales tax on this order instead
                  </label>
                </>
              ) : (
                <span className="tiny faint">Check the account for credit holds first.</span>
              )}
              <div className="pay-boxes">
                <label className="check small">
                  <input type="checkbox" name="cod" defaultChecked={payStart.cod} /> <b>COD Only</b>
                  <span className="tiny faint">Payment collected at pickup or delivery</span>
                </label>
                <label className="check small">
                  <input type="checkbox" name="no_checks" defaultChecked={payStart.noChecks} /> <b>No Checks Allowed</b>
                  <span className="tiny faint">Cash or card only</span>
                </label>
                {payDefaults && (payDefaults.cod || payDefaults.noChecks) && !o.pay_cod && !o.pay_no_checks ? (
                  <span className="tiny faint">Ticked the way this customer was set last time. Change them if that&apos;s different now.</span>
                ) : null}
              </div>
              <Submit className="btn sm block" pendingText="Releasing…">Release order</Submit>
            </form>
            {st !== "hold" ? (
              <details>
                <summary className="linkbtn small">Put on credit hold</summary>
                <form action={creditDecision} className="col" style={{ gap: 8, marginTop: 8 }}>
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="decision" value="hold" />
                  <input className="input sm" name="note" required placeholder="Why, for example: past due 60 days" />
                  <Submit className="btn dark sm" pendingText="Saving…">Put on hold</Submit>
                </form>
              </details>
            ) : null}
          </div>
        ) : null,
    },
    {
      key: "schedule",
      title: pickup ? "Pickup date" : "Delivery date",
      done: Boolean(o.scheduled_for),
      current: st === "schedule",
      detail: o.scheduled_for ? (
        <>
          <b>{dateShort(o.scheduled_for)}</b> · {o.scheduled_by_name}
          {o.schedule_note ? ` · ${o.schedule_note}` : ""}
          <br />
          <span className={o.notify_status === "sent" || o.notify_status === "override" ? "faint" : "red"}>
            {o.notify_status === "sent"
              ? "Customer emailed."
              : o.notify_status === "override"
                ? `Customer approved without email · ${o.notify_override_by ?? ""}${o.notify_override_at ? ` · ${dateTime(o.notify_override_at)}` : ""}`
                : o.notify_status === "not_configured"
                  ? "The customer wasn't emailed (email isn't set up yet)."
                  : o.notify_status
                    ? `Customer email didn't go out${o.notify_error ? `: ${o.notify_error}` : ""}.`
                    : ""}
          </span>
        </>
      ) : st === "schedule" ? (
        "Released by accounting. Set the date and the customer is emailed."
      ) : null,
      extra:
        desk && st === "scheduled" && o.notify_status && o.notify_status !== "sent" && o.notify_status !== "override" ? noEmail(notifyOverride) : null,
      action:
        desk && (st === "schedule" || st === "scheduled") ? (
          <div className="col" style={{ gap: 8 }}>
            <form action={scheduleOrder} className="col" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={o.id} />
              <div className="grid2">
                <input className="input sm" type="date" name="date" required min={today} defaultValue={o.scheduled_for ?? o.needed_by ?? ""} aria-label="Date" />
                <input className="input sm" name="note" defaultValue={o.schedule_note ?? ""} placeholder="Note for the customer (optional)" aria-label="Note" />
              </div>
              <Submit className="btn sm" pendingText="Saving…">{o.scheduled_for ? "Change date & email customer" : "Schedule & email customer"}</Submit>
            </form>
            {o.scheduled_for && o.notify_status !== "sent" && o.notify_status !== "override" && o.notify_status !== "not_configured" ? (
              <form action={resendScheduledEmail}>
                <input type="hidden" name="id" value={o.id} />
                <Submit className="btn dark sm" pendingText="Sending…">Resend customer email</Submit>
              </form>
            ) : null}
          </div>
        ) : null,
    },
    {
      key: "vary2",
      title: "Final item variance check (before loading)",
      check: true,
      done: st === "completed",
      current: false,
      open: Boolean(variance),
      detail: variance && o.ambit_po ? (log2.length ? <VarianceLog log={log2} /> : noChanges) : null,
      extra:
        variance?.canEdit && varyNow === "before_done" ? (
          <ItemVariance data={variance} open={st === "scheduled"} title="Item variance table" />
        ) : null,
    },
    {
      key: "done",
      title: pickup ? "Picked up" : "Delivered",
      done: st === "completed",
      current: st === "scheduled",
      detail: st === "completed" ? (
        <>
          {dateTime(o.completed_at)}
          {payFlags.length ? <> · {payFlags.join(" · ")}</> : null}
        </>
      ) : st === "scheduled" ? "Attach a photo or scan of the signed BOL, then mark it done." : null,
      extra:
        payAlert && st !== "completed" && o.credit_status === "approved" ? (
          <div className="col" style={{ gap: 6 }}>
            {payAlert}
            {bols.length ? <FileLinks orderId={o.id} files={bols} label="Signed BOL" /> : null}
          </div>
        ) : bols.length ? (
          <FileLinks orderId={o.id} files={bols} label="Signed BOL" />
        ) : null,
      action: (desk || warehouse) && st === "scheduled" ? <CompleteForm orderId={o.id} pickup={pickup} hasBol={bols.length > 0} /> : null,
    },
  ];

  return (
    <section className="card col" style={{ gap: 4 }}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="eyebrow">Order desk</div>
        <span className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {o.pay_cod ? <span className="pill red">COD only</span> : null}
          {o.pay_no_checks ? <span className="pill red">No checks</span> : null}
          <span className={STAGES[st].pill}>{STAGES[st].short}</span>
        </span>
      </div>
      <ol className="desk-steps">
        {steps.filter((s) => s.check === undefined || s.open).map((s) => (
          <li key={s.key} className={`${s.done ? "done" : s.current ? "now" : ""}${s.check ? " vary-step" : ""}`}>
            <span className="dot" aria-hidden="true">{s.done ? <Check size={13} strokeWidth={3} /> : s.current && st === "hold" && s.key === "credit" ? <CircleAlert size={13} /> : null}</span>
            <div className="col tight grow" style={{ minWidth: 0 }}>
              <b className="small">{s.title}</b>
              {s.detail ? <div className="tiny muted">{s.detail}</div> : null}
              {s.extra ? <div style={{ marginTop: 6 }}>{s.extra}</div> : null}
              {s.action && s.current ? <div style={{ marginTop: 6 }}>{s.action}</div> : null}
              {s.action && s.done && !s.current ? (
                <details style={{ marginTop: 2 }}>
                  <summary className="linkbtn tiny">Change</summary>
                  <div style={{ marginTop: 6 }}>{s.action}</div>
                </details>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
