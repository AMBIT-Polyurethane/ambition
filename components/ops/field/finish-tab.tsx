"use client";

import { useState } from "react";
import { Check, CircleAlert, FlagTriangleRight } from "lucide-react";
import { isFoam, readingChecks } from "@/lib/ops/field/calc";
import type { FieldTrip, Op, TimeOp } from "@/lib/ops/field/types";
import { Pick, SignaturePad, TextField, YES_NO, nowIso, timeOf, useField } from "./bits";

/** Issues and notes, the sprayer's sign-off, and the customer's signature. */
export function FinishTab({ trip, goTo }: { trip: FieldTrip; goTo: (tab: string) => void }) {
  const { bundle, queue, editable, isLead } = useField();
  const can = editable(trip);
  const lead = isLead(trip);
  const wo = trip.wo;
  const setWo = (k: string, v: unknown) => queue({ t: "wo", trip: trip.id, at: nowIso(), [k]: v } as Op);

  const me = trip.crew.find((c) => c.me);
  const defaultSprayer = wo?.sprayer_crew_id ?? me?.id ?? trip.crew.find((c) => c.lead)?.id ?? trip.crew[0]?.id ?? "";
  const [sprayer, setSprayer] = useState(defaultSprayer);
  const [sprayerName, setSprayerName] = useState("");
  const [cert, setCert] = useState(wo?.sprayer_cert ?? "");
  const [custName, setCustName] = useState(trip.customer.name ?? "");
  const [sig, setSig] = useState<string | null>(null);
  const [absent, setAbsent] = useState(false);
  const [absentNote, setAbsentNote] = useState("");
  const [clockOut, setClockOut] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const stillOn = trip.time.filter((p) => !p.end);
  const foamWork = trip.work.some((w) => isFoam(w.kind));
  const hasStart = trip.days_log.some((d) => readingChecks((d.conditions?.readings as Record<string, Record<string, unknown>> | undefined)?.start).dew !== null);
  const list = [
    { ok: trip.time.length > 0, label: "Time punches", tab: "time" },
    { ok: stillOn.length === 0, label: stillOn.length ? `${stillOn.length} still on the clock` : "Everyone clocked out", tab: "time" },
    { ok: !foamWork || trip.materials.some((m) => isFoam(m.kind)), label: "Sets used and lots", tab: "material" },
    { ok: !foamWork || hasStart, label: "Start-of-day readings", tab: "log" },
    { ok: trip.areas.length > 0, label: "Areas and thickness", tab: "areas" },
    { ok: trip.photos.some((p) => p.kind === "before"), label: "Before photos", tab: "photos" },
    { ok: trip.photos.some((p) => p.kind === "after"), label: "After photos", tab: "photos" },
  ];

  const finish = () => {
    setErr(null);
    if (!sprayerName.trim()) return setErr("The sprayer types their full name to sign the log.");
    if (absent ? !absentNote.trim() : !custName.trim() || !sig) return setErr(absent ? "Say why the customer couldn't sign." : "The customer signs in the box (and their name is typed).");
    const at = nowIso();
    const ops: Op[] = [];
    if (clockOut) {
      for (const p of stillOn) {
        const who = trip.crew.find((c) => c.id === p.crew);
        if (lead || who?.me) ops.push({ t: "time", trip: trip.id, at, id: p.id, crew: p.crew, kind: p.kind, start: p.start, end: at } satisfies TimeOp);
      }
    }
    ops.push({
      t: "finish",
      trip: trip.id,
      at,
      sprayer_crew: sprayer || null,
      sprayer_name: sprayerName.trim(),
      sprayer_cert: cert.trim() || null,
      customer_name: absent ? null : custName.trim(),
      customer_sig: absent ? null : sig,
      customer_absent: absent,
      customer_absent_note: absent ? absentNote.trim() : null,
    });
    queue(ops);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!can) {
    return (
      <section className="card col" style={{ gap: 8 }}>
        <b><Check size={18} style={{ verticalAlign: -3 }} /> Work order finished</b>
        <span className="small">Sprayer: {wo?.sprayer_name ?? "–"}{wo?.sprayer_cert ? ` (${wo.sprayer_cert})` : ""}</span>
        <span className="small">{wo?.customer_absent ? `Customer didn't sign: ${wo.customer_absent_note ?? ""}` : wo?.customer_name ? `Signed by ${wo.customer_name}` : "Customer signature saved"}</span>
        {wo?.finished_at ? <span className="tiny faint">Finished {timeOf(wo.finished_at)}</span> : null}
        {bundle.settings.share_logs ? <span className="tiny faint">A copy of this spray log goes to AMBIT tech support (your company&apos;s setting).</span> : null}
        {wo?.review_note ? <span className="small">Office note: {wo.review_note}</span> : null}
      </section>
    );
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <section className="card col" style={{ gap: 6 }}>
        <b className="small">Before you finish</b>
        {list.map((x) => (
          <button key={x.label} type="button" className="fld-checkrow" onClick={() => goTo(x.tab)}>
            {x.ok ? <Check size={16} className="ok-text" /> : <CircleAlert size={16} className="warn-text" />}
            <span className="grow">{x.label}</span>
          </button>
        ))}
        <span className="tiny faint">These are reminders; you can still finish.</span>
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <b>Issues and notes</b>
        <TextField label="Issue encountered" value={wo?.issue} onSave={(v) => setWo("issue", v)} multiline placeholder="None" maxLength={2000} />
        <Pick label="Did it affect the installed foam?" value={wo?.issue_affected} options={[...YES_NO, { v: "unsure", l: "Not sure" }]} onSave={(v) => setWo("issue_affected", v)} />
        <Pick label="AMBIT tech support contacted?" value={wo?.tech_contacted === true ? "yes" : wo?.tech_contacted === false ? "no" : null} options={YES_NO} onSave={(v) => setWo("tech_contacted", v === null ? null : v === "yes")} />
        <TextField label="Corrective action taken" value={wo?.corrective} onSave={(v) => setWo("corrective", v)} multiline maxLength={2000} />
        <TextField label="Job notes (anything the office or AMBIT should know)" value={wo?.notes} onSave={(v) => setWo("notes", v)} multiline maxLength={4000} />
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <b>Sprayer sign-off</b>
        <label className="field">
          <span className="fld-l">Lead sprayer</span>
          <select className="input" value={sprayer} onChange={(e) => setSprayer(e.target.value)}>
            {trip.crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field"><span className="fld-l">Sprayer certification</span><input className="input" value={cert} onChange={(e) => setCert(e.target.value)} placeholder="SPFA PCP, AMBIT Certified…" /></label>
        <label className="field"><span className="fld-l">Lead sprayer types their full name to sign</span><input className="input" value={sprayerName} onChange={(e) => setSprayerName(e.target.value)} autoComplete="name" /></label>
        <span className="tiny faint">I confirm the information in this log is accurate to the best of my knowledge.</span>
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <b>Customer</b>
        <label className="check"><input type="checkbox" checked={absent} onChange={(e) => setAbsent(e.target.checked)} /> The customer isn&apos;t here to sign</label>
        {absent ? (
          <label className="field"><span className="fld-l">Why not</span><input className="input" value={absentNote} onChange={(e) => setAbsentNote(e.target.value)} placeholder="Homeowner at work; builder's super walked it" /></label>
        ) : (
          <>
            <label className="field"><span className="fld-l">Customer name</span><input className="input" value={custName} onChange={(e) => setCustName(e.target.value)} /></label>
            <span className="small muted">I&apos;m satisfied the work listed on this work order was done.</span>
            <SignaturePad onChange={setSig} />
          </>
        )}
      </section>

      {stillOn.length ? (
        <label className="check"><input type="checkbox" checked={clockOut} onChange={(e) => setClockOut(e.target.checked)} /> Clock out {lead ? "everyone still on the clock" : "me"} now</label>
      ) : null}
      {err ? <div className="alert err small" role="alert"><span>{err}</span></div> : null}
      <button type="button" className="btn block" onClick={finish}><FlagTriangleRight size={18} /> Finish work order</button>
      <span className="tiny faint">Works with no signal: it saves on this phone and goes to the office when you have signal.{bundle.settings.share_logs ? " Your company sends finished spray logs to AMBIT tech support." : ""}</span>
    </div>
  );
}
