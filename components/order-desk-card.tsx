import { Check, CircleAlert } from "lucide-react";
import { Submit } from "@/components/forms";
import { completeOrder, creditDecision, resendScheduledEmail, scheduleOrder, setOrderPo } from "@/app/(app)/orders/actions";
import { dateShort, dateTime } from "@/lib/format";
import { STAGES, stageOf } from "@/lib/order-desk";
import type { Order } from "@/lib/types";
import { TAX_STATE, taxLine, type TaxInfo } from "@/lib/tax";

type Step = { key: string; title: string; done: boolean; current: boolean; detail?: React.ReactNode; action?: React.ReactNode };

/** Staff view of where the order is and the next step, for whoever's job it is. */
export function OrderDeskCard({ order, desk, credit, warehouse, tax }: { order: Order; desk: boolean; credit: boolean; warehouse: boolean; tax?: TaxInfo | null }) {
  const st = stageOf(order);
  if (!st || st === "cancelled") return null;
  const o = order;
  const pickup = o.delivery_method === "pickup";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const contractor = o.placed_by_role === "customer";

  const steps: Step[] = [
    {
      key: "customer",
      title: contractor ? "Placed and approved by the customer" : "Customer approval",
      done: st !== "customer",
      current: st === "customer",
      detail:
        st === "customer"
          ? "Waiting for the customer to approve the emailed order."
          : o.approved_at
            ? `${o.approved_by_name ?? ""} · ${dateTime(o.approved_at)}`
            : o.approval_status === "not_required"
              ? "Not needed for this order"
              : null,
    },
    {
      key: "po",
      title: "AMBIT PO #",
      done: Boolean(o.ambit_po),
      current: st === "needs_po",
      detail: o.ambit_po ? <><b>{o.ambit_po}</b> · {o.po_by_name} · {dateTime(o.po_at)}</> : null,
      action:
        desk && st !== "customer" && st !== "completed" ? (
          <form action={setOrderPo} className="row" style={{ gap: 8 }}>
            <input type="hidden" name="id" value={o.id} />
            <input className="input sm grow" name="po" required defaultValue={o.ambit_po ?? ""} placeholder="AMBIT PO #" aria-label="AMBIT PO number" />
            <Submit className="btn sm" pendingText="Saving…">{o.ambit_po ? "Change" : "Save PO #"}</Submit>
          </form>
        ) : null,
    },
    {
      key: "credit",
      title: "Credit check",
      done: o.credit_status === "approved",
      current: st === "credit" || st === "hold",
      detail:
        o.credit_status === "approved" ? (
          `Released by ${o.credit_by_name ?? ""} · ${dateTime(o.credit_at)}${o.credit_note ? ` · ${o.credit_note}` : ""}`
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
          <span className={o.notify_status === "sent" ? "faint" : "red"}>
            {o.notify_status === "sent"
              ? "Customer emailed."
              : o.notify_status
                ? `Customer email didn't go out${o.notify_error ? `: ${o.notify_error}` : ""}.`
                : ""}
          </span>
        </>
      ) : st === "schedule" ? (
        "Released by accounting. Set the date and the customer is emailed."
      ) : null,
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
            {o.scheduled_for && o.notify_status !== "sent" ? (
              <form action={resendScheduledEmail}>
                <input type="hidden" name="id" value={o.id} />
                <Submit className="btn dark sm" pendingText="Sending…">Resend customer email</Submit>
              </form>
            ) : null}
          </div>
        ) : null,
    },
    {
      key: "done",
      title: pickup ? "Picked up" : "Delivered",
      done: st === "completed",
      current: st === "scheduled",
      detail: st === "completed" ? dateTime(o.completed_at) : null,
      action:
        (desk || warehouse) && st === "scheduled" ? (
          <form action={completeOrder}>
            <input type="hidden" name="id" value={o.id} />
            <Submit className="btn dark sm" pendingText="Saving…">{pickup ? "Mark picked up" : "Mark delivered"}</Submit>
          </form>
        ) : null,
    },
  ];

  return (
    <section className="card col" style={{ gap: 4 }}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="eyebrow">Order desk</div>
        <span className={STAGES[st].pill}>{STAGES[st].short}</span>
      </div>
      <ol className="desk-steps">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? "done" : s.current ? "now" : ""}>
            <span className="dot" aria-hidden="true">{s.done ? <Check size={13} strokeWidth={3} /> : s.current && st === "hold" && s.key === "credit" ? <CircleAlert size={13} /> : null}</span>
            <div className="col tight grow" style={{ minWidth: 0 }}>
              <b className="small">{s.title}</b>
              {s.detail ? <span className="tiny muted">{s.detail}</span> : null}
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
