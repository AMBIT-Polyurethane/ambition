"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, CircleAlert, CircleCheck, FileQuestion, Link2, Send, Unlink } from "lucide-react";
import { linkCharge, submitMonth, type SubmitState } from "@/app/(app)/expenses/actions";
import { Submit } from "@/components/forms";
import { dateShort, money } from "@/lib/format";
import { daysApart, receiptPhotoHref, type XReceipt } from "@/lib/expense-kinds";

/** One card charge with no receipt: add it, pick one already uploaded, or say it's lost. */
export function MissingCharge({
  charge,
  candidates,
  locked,
}: {
  charge: { id: string; txn_date: string; label: string; amount: number; card: string | null };
  candidates: Pick<XReceipt, "id" | "bought_on" | "vendor" | "amount" | "photos" | "paid_with">[];
  locked: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const near = candidates
    .filter((r) => daysApart(r.bought_on, charge.txn_date) <= 10)
    .sort((a, b) => Math.abs(a.amount - charge.amount) - Math.abs(b.amount - charge.amount) || daysApart(a.bought_on, charge.txn_date) - daysApart(b.bought_on, charge.txn_date))
    .slice(0, 6);
  const pick = (id: string) =>
    start(async () => {
      setErr(null);
      const r = await linkCharge(charge.id, id);
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  return (
    <div className="xm-row">
      <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <b className="ellipsis">{charge.label}</b>
          <span className="tiny muted">
            {dateShort(charge.txn_date)}
            {charge.card ? ` · card ••${charge.card}` : ""}
          </span>
        </div>
        <b className="nowrap">{money(charge.amount)}</b>
      </div>
      {locked ? null : (
        <div className="xm-acts">
          <Link className="btn sm" href={`/expenses/add?charge=${charge.id}`}>
            <Camera size={15} /> Add receipt
          </Link>
          {near.length ? (
            <button type="button" className="btn sm dark" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
              <Link2 size={15} /> I uploaded it
            </button>
          ) : null}
          <Link className="btn sm dark" href={`/expenses/add?charge=${charge.id}&lost=1`}>
            <FileQuestion size={15} /> Lost receipt
          </Link>
        </div>
      )}
      {picking ? (
        <div className="xm-pick">
          <span className="tiny muted">Which receipt is it?</span>
          {near.map((r) => (
            <button key={r.id} type="button" className="xm-cand" disabled={pending} onClick={() => pick(r.id)}>
              {r.photos.length ? <img src={receiptPhotoHref(r.id, 0, 120)} alt="" className="exp-thumb sm" /> : <span className="exp-thumb sm" />}
              <span className="grow col" style={{ gap: 1, minWidth: 0, textAlign: "left" }}>
                <span className="ellipsis" style={{ fontWeight: 700 }}>{r.vendor}</span>
                <span className="tiny muted">
                  {dateShort(r.bought_on)}
                  {r.paid_with === "personal" ? " · marked paid personally" : ""}
                </span>
              </span>
              <b className="nowrap">{money(r.amount)}</b>
            </button>
          ))}
        </div>
      ) : null}
      {err ? <div className="alert err small" style={{ margin: 0 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} /><span>{err}</span></div> : null}
    </div>
  );
}

/** Undo a match (wrong receipt on a charge). */
export function UnlinkButton({ chargeId }: { chargeId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="xm-unlink"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await linkCharge(chargeId, null);
          if (r.ok) router.refresh();
        })
      }
    >
      <Unlink size={13} /> Not this charge
    </button>
  );
}

export function SubmitMonth({ month, blocked, locked }: { month: string; blocked: string | null; locked?: boolean }) {
  const [state, action] = useActionState<SubmitState, FormData>(submitMonth, null);
  return (
    <>
      <form action={action} hidden={locked}>
        <input type="hidden" name="month" value={month} />
        {blocked ? (
          <button type="button" className="btn sm" disabled>
            <Send size={15} /> Send for approval
          </button>
        ) : (
          <Submit className="btn sm" pendingText="Sending…">
            <Send size={15} /> Send for approval
          </Submit>
        )}
      </form>
      {blocked && !state && !locked ? <span className="tiny muted" style={{ flexBasis: "100%" }}>{blocked}</span> : null}
      {state?.ok ? <div className="alert ok small" role="status" style={{ margin: 0, flexBasis: "100%" }}><CircleCheck size={17} style={{ flex: "none", marginTop: 1 }} /><span>{state.ok}</span></div> : null}
      {state?.warn ? <div className="alert warn small" role="status" style={{ margin: 0, flexBasis: "100%" }}><span>{state.warn}</span></div> : null}
      {state?.error ? <div className="alert err small" role="alert" style={{ margin: 0, flexBasis: "100%" }}><CircleAlert size={17} style={{ flex: "none", marginTop: 1 }} /><span>{state.error}</span></div> : null}
    </>
  );
}
