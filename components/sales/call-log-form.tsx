"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { saveCall } from "@/app/(app)/sales/actions";
import { outcomes, type CallList, type Outcome } from "@/lib/calls-shared";

/** "How did it go?" on one call: the outcome, what they said, and when to call back. Then on to the next one. */
export function CallLogForm({ id, list, today, next, companyId }: { id: number; list: CallList; today: string; next: string | null; companyId: string | null }) {
  const router = useRouter();
  const [o, setO] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [day, setDay] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ outcome: Outcome; lead: string | null } | null>(null);
  const [pending, go] = useTransition();
  const save = (thenNext: boolean) =>
    go(async () => {
      setErr("");
      if (!o) return setErr("Pick how the call went.");
      if (o === "callback" && !day) return setErr("Pick the day to call back.");
      const r = await saveCall({ id, outcome: o, note, next_on: day || null });
      if (!r.ok) return setErr(r.error);
      if (thenNext && next && o !== "won") return router.push(next);
      setDone({ outcome: o, lead: r.lead_id });
      setO(null); setNote(""); setDay("");
      router.refresh();
    });
  return (
    <section className="card2 col" aria-label="Log this call" style={{ gap: 14, padding: 18 }}>
      <b style={{ fontSize: 16 }}>How did it go?</b>
      {done ? (
        <div className="alert ok small" role="status">
          <CircleCheck size={16} aria-hidden />
          <span>
            Saved.{" "}
            {done.outcome === "won" && done.lead ? <>They&apos;re in your <Link href="/sales/pipeline">New-customer pipeline</Link> now.</> : null}
            {done.outcome === "won" && list === "winback" && companyId ? <><Link href={`/order?smart=all&company=${companyId}`}>Start their order</Link> (their prices fill in).</> : null}
            {next ? <> <Link href={next}>Next call</Link></> : null}
          </span>
        </div>
      ) : null}
      <div className="chips wrap" role="radiogroup" aria-label="Outcome">
        {outcomes(list).map((x) => (
          <button key={x.key} type="button" role="radio" aria-checked={o === x.key} className={`chip${o === x.key ? " on" : ""}`} onClick={() => setO(x.key)}>{x.label}</button>
        ))}
      </div>
      <label className="field">
        <span className="label">What they said</span>
        <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={list === "winback" ? "Why they stopped, who they buy from now, what they pay, what would bring them back" : "What they spray, how much, who they buy from, what they need"} />
      </label>
      {o !== "won" && o !== "not_interested" && o !== "wrong_number" ? (
        <label className="field" style={{ maxWidth: 220 }}>
          <span className="label">{o === "callback" ? "Call back on" : "Call back on (optional)"}</span>
          <input className="input" type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
      ) : null}
      {o === "won" ? <span className="tiny muted">{list === "cold" ? "Saving adds them to your New-customer pipeline as a new lead." : "Saving marks them won back. Then start their order."}</span> : null}
      {err ? <span className="small red">{err}</span> : null}
      <div className="row wrap" style={{ gap: 8 }}>
        {next ? <button type="button" className="b2" disabled={pending} onClick={() => save(true)}>{pending ? <LoaderCircle size={16} className="spin" /> : null} Save and go to the next call</button> : null}
        <button type="button" className={`b2${next ? " quiet" : ""}`} disabled={pending} onClick={() => save(false)}>{pending && !next ? <LoaderCircle size={16} className="spin" /> : null} Save</button>
      </div>
    </section>
  );
}
