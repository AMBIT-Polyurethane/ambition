"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Lock } from "lucide-react";
import { decideForm, revealSecret } from "@/lib/forms/actions";

/** Approve / deny, with the extras each form needs: a credit line for a credit application, "create the customer" for an account setup. */
export function DecidePanel({ id, formKey, hasCompany, requested, terms: t0 }: { id: number; formKey: string; hasCompany: boolean; requested: string; terms: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [limit, setLimit] = useState(requested);
  const [terms, setTerms] = useState(t0 || "Net 30");
  const [create, setCreate] = useState(!hasCompany);
  const [err, setErr] = useState("");
  const [pending, go] = useTransition();
  const decide = (status: "approved" | "denied") => go(async () => {
    setErr("");
    const r = await decideForm({ id, status, note, limit: formKey === "credit_app" ? limit : undefined, terms, createCustomer: formKey === "account_setup" && create });
    if (!r.ok) return setErr(r.error);
    router.refresh();
  });
  return (
    <section className="card col" style={{ gap: 12 }}>
      <b>Your decision</b>
      {formKey === "credit_app" ? (
        hasCompany ? (
          <div className="grid2">
            <label className="field"><span className="label">Credit line to give</span><input className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.,]/g, ""))} /></label>
            <label className="field"><span className="label">Terms</span>
              <select className="select" value={terms} onChange={(e) => setTerms(e.target.value)}>{["Due on receipt", "Net 10", "Net 15", "Net 30", "2% 10 Net 30", "Net 45", "Net 60"].map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
        ) : <span className="small muted">Approve the account setup first (it creates the customer); then the line can be set here or on their dashboard.</span>
      ) : null}
      {formKey === "account_setup" && !hasCompany ? (
        <label className="check small"><input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} /> Create the customer in the app when I approve (their price request prices carry over)</label>
      ) : null}
      <label className="field"><span className="label">Note (they&apos;ll see it)</span><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err ? <span className="small red">{err}</span> : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={pending} onClick={() => decide("approved")}>Approve</button>
        <button type="button" className="btn dark" disabled={pending} onClick={() => decide("denied")}>Deny</button>
      </div>
    </section>
  );
}

/** "•••• 6789 · Show": reveals one private number to Accounting, on purpose, one at a time. */
export function Reveal({ id, field, masked }: { id: number; field: string; masked: string }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex" }}>
      <Lock size={13} className="faint" /> <span style={{ fontFamily: "ui-monospace, monospace" }}>{v || masked}</span>
      {!v ? <button type="button" className="link-btn tiny" onClick={async () => { const r = await revealSecret(id, field); if (r.ok) { setV(r.value); setTimeout(() => setV(""), 30000); } else setErr(r.error); }}><Eye size={12} /> Show</button> : null}
      {err ? <span className="tiny red">{err}</span> : null}
    </span>
  );
}
