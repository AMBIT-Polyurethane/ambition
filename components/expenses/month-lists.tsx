import Link from "next/link";
import { Camera, CircleCheck, Clock, FileQuestion, Users } from "lucide-react";
import { dateShort, money } from "@/lib/format";
import { chargeLabel, receiptPhotoHref, type MonthView } from "@/lib/expense-kinds";
import { MissingCharge } from "@/components/expenses/month-bits";

// The lists on a month: card charges with no receipt, the receipts (and whether the bank has shown each
// one), and other card activity (returns, fees, "no receipt needed"). Used by the employee's own Expenses
// screen and the approver's review screen.

export function MissingList({ view, locked, title = "Card charges that need a receipt" }: { view: MonthView; locked: boolean; title?: string }) {
  if (!view.missing.length) return null;
  const total = view.missing.reduce((a, c) => a + Number(c.amount), 0);
  return (
    <section className="section">
      <div className="row between">
        <div className="eyebrow" style={{ color: "var(--err-text)" }}>{title}</div>
        <span className="tiny muted">{view.missing.length} · {money(total)}</span>
      </div>
      <div className="list xm-list">
        {view.missing.map((c) => (
          <MissingCharge
            key={c.id}
            locked={locked}
            charge={{ id: c.id, txn_date: c.txn_date, label: chargeLabel(c), amount: Number(c.amount), card: c.card_last4 }}
            candidates={view.loose.map((r) => ({ id: r.id, bought_on: r.bought_on, vendor: r.vendor, amount: Number(r.amount), photos: r.photos, paid_with: r.paid_with }))}
          />
        ))}
      </div>
    </section>
  );
}

export function ReceiptList({ view, editable, empty, backTo }: { view: MonthView; editable: boolean; empty: string; backTo?: string }) {
  return (
    <section className="section">
      <div className="eyebrow">Receipts</div>
      {view.receipts.length === 0 ? (
        <div className="card small muted center">{empty}</div>
      ) : (
        <div className="list">
          {view.receipts.map((r) => {
            const c = view.chargeFor.get(r.id);
            const diff = c ? Math.round((Number(c.amount) - Number(r.amount)) * 100) / 100 : 0;
            const body = (
              <>
                {r.photos.length ? (
                  <img className="exp-thumb" src={receiptPhotoHref(r.id, 0, 160)} alt="" loading="lazy" />
                ) : (
                  <span className="exp-thumb empty" title="Lost receipt">
                    <FileQuestion size={18} />
                  </span>
                )}
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="t ellipsis">{r.vendor || "Receipt"}</span>
                  <span className="s ellipsis">
                    {dateShort(r.bought_on)} · {r.category}
                    {r.purpose ? ` · ${r.purpose}` : ""}
                  </span>
                  {r.customer_name || r.attendees ? (
                    <span className="xm-cust ellipsis">
                      <Users size={12} /> {[r.customer_name, r.attendees].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
                <span className="col" style={{ alignItems: "flex-end", gap: 4 }}>
                  <b className="nowrap">{money(c ? Number(c.amount) : Number(r.amount))}</b>
                  {r.paid_with === "personal" ? (
                    <span className="pill warn" style={{ fontSize: 9 }}>Pay back</span>
                  ) : c ? (
                    <span className="pill ok xm-pill" title={`Card charge ${dateShort(c.txn_date)}: ${chargeLabel(c)}`}>
                      <CircleCheck size={10} /> On card{diff > 0.004 ? ` +${money(diff)} tip` : ""}
                    </span>
                  ) : (
                    <span className="pill grey xm-pill" title="The bank hasn't shown this charge yet">
                      <Clock size={10} /> Bank pending
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <div key={r.id} className="xm-rwrap">
                {editable ? (
                  <Link className="item exp-item" href={`/expenses/add?id=${r.id}${backTo ? `&back=${encodeURIComponent(backTo)}` : ""}`}>
                    {body}
                  </Link>
                ) : (
                  <a className="item exp-item" href={r.photos.length ? receiptPhotoHref(r.id) : undefined} target="_blank" rel="noopener noreferrer">
                    {body}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Returns, fees and charges an approver said need no receipt. */
export function OtherCharges({ view }: { view: MonthView }) {
  const other = view.charges.filter((c) => !c.receipt_id && (c.kind !== "purchase" || c.excused_note) && c.kind !== "other");
  if (!other.length) return null;
  return (
    <section className="section">
      <div className="eyebrow">Other card activity</div>
      <div className="list">
        {other.map((c) => (
          <div key={c.id} className="item" style={{ minHeight: 54 }}>
            <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
              <span className="t ellipsis" style={{ fontSize: 14 }}>{chargeLabel(c)}</span>
              <span className="s ellipsis">
                {dateShort(c.txn_date)} · {c.kind === "return" ? "Return / credit" : c.kind === "fee" ? "Bank fee" : `No receipt needed: ${c.excused_note}`}
              </span>
            </span>
            <b className="nowrap">{money(Number(c.amount))}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The month's totals and how many card charges have their receipt. */
export function MonthSummary({ view, label }: { view: MonthView; label: string }) {
  const t = view.totals;
  const done = t.matched + view.charges.filter((c) => c.kind === "purchase" && !c.receipt_id && c.excused_note).length;
  const pct = t.charges ? Math.round((done / t.charges) * 100) : 0;
  return (
    <section className="card exp-sum">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div className="col" style={{ gap: 2 }}>
          <span className="tiny faint">TOTAL · {label.toUpperCase()}</span>
          <span className="exp-total">{money(t.total)}</span>
        </div>
        <span className="small muted">
          {t.receipts} {t.receipts === 1 ? "receipt" : "receipts"}
        </span>
      </div>
      <div className="exp-split">
        <span><i className="exp-dot c-card" /> AMBIT card <b>{money(t.card)}</b></span>
        <span><i className="exp-dot personal" /> Pay back to you <b>{money(t.personal)}</b></span>
      </div>
      {t.charges ? (
        <div className="xm-meter" aria-label={`${t.matched} of ${t.charges} card charges have a receipt`}>
          <div className="row between tiny">
            <span className="muted">Card charges with a receipt</span>
            <b>
              {done} of {t.charges}
            </b>
          </div>
          <div className="xm-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <span className="tiny muted">
          <Camera size={12} style={{ verticalAlign: -2 }} /> No card charges for this month yet. They show up when the Chase statement comes in.
        </span>
      )}
      {t.byCategory.length ? (
        <div className="exp-cats">
          {t.byCategory.map((c) => (
            <span key={c.category} className="exp-cat">
              {c.category} <b>{money(c.total)}</b>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
