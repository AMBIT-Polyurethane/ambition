"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { markAdcPaid } from "./actions";

function Go() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="b2 sm" disabled={pending}>
      {pending ? <><LoaderCircle size={15} className="spin" /> Saving</> : "Mark paid"}
    </button>
  );
}

/** "They paid": total for the goods, AM-BUCKS they used, and a note. Posts their 3% AM-BUCKS. */
export function WebPay({ id, guess, bucks, hasAccount }: { id: number; guess: number; bucks: number | null; hasAccount: boolean }) {
  const [s, act] = useActionState(markAdcPaid, null);
  if (s?.ok) return <div className="alert ok small"><CircleCheck size={16} aria-hidden="true" /> {s.ok}</div>;
  return (
    <form action={act} className="webo-pay">
      <input type="hidden" name="id" value={id} />
      <label className="webo-pay-f">
        <span>Paid for the goods ($)</span>
        <input className="input sm" name="total" inputMode="decimal" required defaultValue={guess ? guess.toFixed(2) : ""} placeholder="0.00" />
      </label>
      <label className="webo-pay-f">
        <span>AM-BUCKS used ($)</span>
        <input className="input sm" name="bucks" inputMode="decimal" defaultValue={bucks ? bucks.toFixed(2) : ""} placeholder={hasAccount ? "0.00" : "No account"} disabled={!hasAccount} />
      </label>
      <label className="webo-pay-f grow">
        <span>Note</span>
        <input className="input sm" name="note" placeholder="Entered as ORD-1234, paid by card..." />
      </label>
      <Go />
      {s?.error ? <div className="alert warn small"><CircleAlert size={16} aria-hidden="true" /> {s.error}</div> : null}
      <span className="tiny faint">Don&apos;t count shipping or tax. {hasAccount ? "They earn 3 points per $100 (3%) when you save." : "No ADC account: no AM-BUCKS."}</span>
    </form>
  );
}
