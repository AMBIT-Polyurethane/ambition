"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CircleAlert, CircleCheck, CreditCard, FileMinus2, Landmark, ReceiptText, RotateCcw, Undo2, WalletCards, X } from "lucide-react";
import { money } from "@/lib/format";
import { recordPayment, type PaymentInput } from "@/app/(app)/credit/actions";

// Customer dashboard › Record a payment. Every way money comes in (check with the check #, ACH, wire, credit or
// debit card, cash, Zelle, money order, cashier's check), account credits, refunds and write-offs, applied to the
// open invoices it pays (oldest first with one tap), or left on account to come off the oldest past due.

export type OpenInv = { id: number; doc_no: string | null; txn_date: string; due_date: string | null; remaining: number; late: number; kind: string; where?: string };

type Kind = "payment" | "credit" | "refund" | "write_off";
const PAY = [
  { key: "check", label: "Check", icon: ReceiptText },
  { key: "ach", label: "ACH", icon: Landmark },
  { key: "wire", label: "Wire", icon: Landmark },
  { key: "card", label: "Credit card", icon: CreditCard },
  { key: "debit", label: "Debit card", icon: CreditCard },
  { key: "cash", label: "Cash", icon: Banknote },
  { key: "zelle", label: "Zelle", icon: WalletCards },
  { key: "money_order", label: "Money order", icon: ReceiptText },
  { key: "cashiers_check", label: "Cashier's check", icon: ReceiptText },
  { key: "other", label: "Other", icon: WalletCards },
] as const;
const REFUND = PAY.filter((m) => ["check", "ach", "wire", "card", "debit", "other"].includes(m.key));
const CREDIT_REASONS = ["Returned material", "Pricing adjustment", "Freight credit", "Damaged / defective product", "Short shipment", "Other"];
const REF_LABEL: Record<string, string> = { check: "Check #", cashiers_check: "Check #", money_order: "Money order #", ach: "ACH trace / confirmation #", wire: "Wire reference", zelle: "Zelle confirmation #", card: "Approval code", debit: "Approval code", cash: "Receipt #", other: "Reference" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => {
  const t = s.replace(/[$,\s]/g, "");
  return /^\d+(\.\d{0,2})?$/.test(t) ? Number(t) : NaN;
};

export function PaymentForm({ company, invoices, terms, admin, setter, today, onDone }: {
  company: string; invoices: OpenInv[]; terms: string | null; admin: boolean; setter: boolean; today: string; onDone?: (said: string) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("payment");
  const [method, setMethod] = useState("check");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today);
  const [checkNo, setCheckNo] = useState("");
  const [ref, setRef] = useState("");
  const [last4, setLast4] = useState("");
  const [fee, setFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState(CREDIT_REASONS[0]);
  const [note, setNote] = useState("");
  const [apply, setApply] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();

  const amt = num(amount);
  const disc = kind === "payment" && discount ? num(discount) : 0;
  const pool = (Number.isFinite(amt) ? amt : 0) + (Number.isFinite(disc) ? disc : 0);
  const applied = r2(Object.values(apply).reduce((s, v) => s + (Number.isFinite(num(v)) ? num(v) : 0), 0));
  const left = r2(pool - applied);
  const open = useMemo(() => invoices.filter((i) => i.remaining > 0.004).sort((a, b) => (a.due_date ?? a.txn_date).localeCompare(b.due_date ?? b.txn_date)), [invoices]);
  const credits = useMemo(() => invoices.filter((i) => i.remaining < -0.004), [invoices]);
  const earlyPay = /(\d+(?:\.\d+)?)\s*%\s*(\d+)/.exec(terms ?? "");

  function oldestFirst() {
    let rest = pool;
    const next: Record<number, string> = {};
    for (const i of open) {
      if (rest <= 0.004) break;
      const a = r2(Math.min(rest, i.remaining));
      next[i.id] = a.toFixed(2);
      rest = r2(rest - a);
    }
    setApply(next);
  }
  function toggle(i: OpenInv, on: boolean) {
    setApply((cur) => {
      const next = { ...cur };
      if (!on) delete next[i.id];
      else {
        const room = r2(pool - Object.entries(cur).filter(([k]) => Number(k) !== i.id).reduce((s, [, v]) => s + (num(v) || 0), 0));
        next[i.id] = Math.max(0, Math.min(i.remaining, room > 0 ? room : i.remaining)).toFixed(2);
      }
      return next;
    });
  }

  function submit() {
    setMsg(null);
    if (!(amt > 0)) return setMsg({ ok: false, text: "Type the amount (like 2450.00)." });
    const m = kind === "credit" ? "account_credit" : kind === "write_off" ? "write_off" : method;
    if (kind === "payment" && (m === "check" || m === "cashiers_check") && !checkNo.trim()) return setMsg({ ok: false, text: "Type the check number." });
    if ((m === "card" || m === "debit") && last4 && !/^\d{4}$/.test(last4)) return setMsg({ ok: false, text: "Card: only the last 4 digits." });
    if ((kind === "credit" || kind === "write_off") && !note.trim() && reason === "Other") return setMsg({ ok: false, text: "Say what the credit is for." });
    if (applied > pool + 0.004) return setMsg({ ok: false, text: `You applied ${money(applied)} but only have ${money(pool)}. Lower an invoice.` });
    const p: PaymentInput = {
      company, kind: kind === "write_off" ? "credit" : kind, method: m, amount: amt, paid_on: day,
      check_no: kind === "payment" && (m === "check" || m === "cashiers_check") ? checkNo : undefined,
      ref: ref || undefined,
      note: kind === "credit" || kind === "write_off" ? [reason, note.trim()].filter(Boolean).join(": ") : note || undefined,
      discount: Number.isFinite(disc) ? disc : 0,
      card_fee: (m === "card" || m === "debit") && fee ? num(fee) : null,
      last4: (m === "card" || m === "debit") && last4 ? last4 : undefined,
      apply: kind === "refund" ? [] : Object.entries(apply).map(([k, v]) => ({ invoice_id: Number(k), amount: num(v) })).filter((a) => a.amount > 0),
    };
    go(async () => {
      const r = await recordPayment(p);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      const what = kind === "refund" ? "Refund" : kind === "credit" ? "Account credit" : kind === "write_off" ? "Write-off" : "Payment";
      const said = `${what} of ${money(amt)} recorded${applied > 0 ? `, ${money(applied)} applied to ${Object.keys(apply).length} invoice${Object.keys(apply).length === 1 ? "" : "s"}` : ""}${left > 0.004 && kind !== "refund" ? `, ${money(left)} on account` : ""}.`;
      setMsg({ ok: true, text: `${said} The balance updates now.` });
      setAmount(""); setCheckNo(""); setRef(""); setLast4(""); setFee(""); setDiscount(""); setNote(""); setApply({});
      router.refresh();
      onDone?.(said);
    });
  }

  const tabs: { key: Kind; label: string; icon: typeof Banknote; show: boolean }[] = [
    { key: "payment", label: "Payment received", icon: Banknote, show: true },
    { key: "credit", label: "Account credit", icon: FileMinus2, show: true },
    { key: "refund", label: "Refund", icon: Undo2, show: setter },
    { key: "write_off", label: "Write-off", icon: RotateCcw, show: admin },
  ];

  return (
    <div className="pay-form col" style={{ gap: 14 }}>
      <div className="seg" role="tablist" aria-label="What happened">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={kind === t.key} className={kind === t.key ? "on" : ""}
            onClick={() => { setKind(t.key); setMsg(null); if (t.key === "refund" && !REFUND.some((m) => m.key === method)) setMethod("check"); }}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {kind === "payment" || kind === "refund" ? (
        <div className="col" style={{ gap: 6 }}>
          <span className="label">{kind === "refund" ? "Refunded by" : "Paid by"}</span>
          <div className="pay-methods">
            {(kind === "refund" ? REFUND : PAY).map((m) => (
              <button key={m.key} type="button" className={`pay-m${method === m.key ? " on" : ""}`} aria-pressed={method === m.key} onClick={() => setMethod(m.key)}>
                <m.icon size={17} /><span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <label className="field">
          <span className="label">{kind === "credit" ? "What the credit is for" : "Why it's written off"}</span>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {(kind === "credit" ? CREDIT_REASONS : ["Uncollectible (sent to collections)", "Customer out of business", "Settlement", "Small balance", "Other"]).map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      )}

      <div className="grid2">
        <label className="field">
          <span className="label">{kind === "refund" ? "Amount refunded" : kind === "credit" ? "Credit amount" : kind === "write_off" ? "Amount written off" : "Amount received"}</span>
          <input className="input big-num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" autoFocus />
        </label>
        <label className="field"><span className="label">{kind === "payment" ? "Date received" : "Date"}</span><input className="input" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>
        {kind === "payment" && (method === "check" || method === "cashiers_check") ? (
          <label className="field"><span className="label">Check # <span className="red">*</span></span><input className="input" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} maxLength={30} inputMode="numeric" /></label>
        ) : null}
        {(kind === "payment" || kind === "refund") && (method === "card" || method === "debit") ? (
          <>
            <label className="field"><span className="label">Card last 4 (optional)</span><input className="input" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234" /></label>
            {kind === "payment" ? <label className="field"><span className="label">Card fee charged (optional)</span><input className="input" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="$0.00" /></label> : null}
          </>
        ) : null}
        {kind !== "write_off" && !(kind === "payment" && (method === "check" || method === "cashiers_check")) ? (
          <label className="field"><span className="label">{kind === "credit" ? "Credit memo # (optional)" : `${REF_LABEL[method] ?? "Reference"} (optional)`}</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} /></label>
        ) : null}
        {kind === "payment" && earlyPay ? (
          <label className="field">
            <span className="label">Early-pay discount taken ({earlyPay[1]}% if paid within {earlyPay[2]} days)</span>
            <input className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="$0.00" />
          </label>
        ) : null}
      </div>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder={kind === "credit" || kind === "write_off" ? "Details (invoice, RMA #, who approved it)" : "Note (optional)"} aria-label="Note" />

      {kind !== "refund" ? (
        <section className="col" style={{ gap: 8 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <b className="small">Apply to open invoices</b>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm ghost" onClick={oldestFirst} disabled={!(pool > 0) || !open.length}>Apply oldest first</button>
              {Object.keys(apply).length ? <button type="button" className="btn sm ghost" onClick={() => setApply({})}><X size={14} /> Clear</button> : null}
            </div>
          </div>
          {open.length ? (
            <div className="pay-inv">
              {open.map((i) => {
                const on = apply[i.id] !== undefined;
                return (
                  <label key={i.id} className={`pay-inv-row${on ? " on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={(e) => toggle(i, e.target.checked)} aria-label={`Apply to invoice ${i.doc_no ?? ""}`} />
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <b className="small">{i.kind === "invoice" ? "Inv" : i.kind === "credit_memo" ? "Credit memo" : i.kind} {i.doc_no ?? "—"}{i.where ? <span className="tiny faint" style={{ fontWeight: 400 }}> · {i.where}</span> : null}</b>
                      <span className="tiny faint">Due {i.due_date ? new Date(`${i.due_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"}
                        {i.late > 0 ? <b className={i.late > 30 ? "red" : "warn-text"}> · {i.late} days late</b> : <span> · current</span>}</span>
                    </span>
                    <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>{money(i.remaining)}</span>
                    {on ? (
                      <input className="input sm pay-amt" value={apply[i.id]} onChange={(e) => setApply((c) => ({ ...c, [i.id]: e.target.value }))} inputMode="decimal" aria-label="Amount applied" onClick={(e) => e.preventDefault()} />
                    ) : <span className="pay-amt" />}
                  </label>
                );
              })}
            </div>
          ) : <span className="small muted">No open invoices. It goes on account.</span>}
          {credits.length ? <span className="tiny faint">{credits.length} open credit{credits.length === 1 ? "" : "s"} in QuickBooks ({money(credits.reduce((s, c) => s + c.remaining, 0))}) already count against the balance.</span> : null}
          <div className="pay-sum">
            <span>Received{disc > 0 ? " + discount" : ""} <b>{money(pool)}</b></span>
            <span>Applied <b>{money(applied)}</b></span>
            <span className={left < -0.004 ? "red" : ""}>{left < -0.004 ? "Over by" : "On account"} <b>{money(Math.abs(left))}</b></span>
          </div>
          {left > 0.004 && pool > 0 ? <span className="tiny faint">What isn&apos;t applied stays on account and comes off the oldest past due automatically.</span> : null}
        </section>
      ) : (
        <span className="tiny faint">A refund adds back to the balance (it pays out a credit the customer had). Only admins and accounting record refunds.</span>
      )}

      {msg ? (
        <div className={`alert ${msg.ok ? "ok" : "err"}`} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />}<span>{msg.text}</span>
        </div>
      ) : null}
      <button type="button" className="btn" disabled={pending} onClick={submit}>
        {pending ? "Saving…" : kind === "refund" ? "Record refund" : kind === "credit" ? "Record account credit" : kind === "write_off" ? "Write it off" : "Record payment"}
      </button>
      <span className="tiny faint">Enter it in QuickBooks too (for now). The next QuickBooks import replaces these invoices, and payments entered here before that date drop off automatically.</span>
    </div>
  );
}
