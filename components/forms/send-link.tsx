"use client";

import { useState, useTransition } from "react";
import { Copy, Mail, Send } from "lucide-react";
import type { Data } from "@/lib/forms/engine";
import { sendFormLink } from "@/lib/forms/actions";

/** "Customer isn't with you? Email them the link." They fill it in on their phone; it comes back to the app. */
export function SendLink({ formKey, prf, company, prefill, email: e0, name: n0, title }: { formKey: "credit_app" | "account_setup"; prf: number | null; company: string | null; prefill: Data; email: string; name: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(e0);
  const [name, setName] = useState(n0);
  const [res, setRes] = useState<{ url: string; emailed: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [pending, go] = useTransition();
  if (!open) return (
    <button type="button" className="fx-send card" onClick={() => setOpen(true)}>
      <Mail size={18} /><span className="col tight grow" style={{ textAlign: "left" }}><b className="small">Customer not with you?</b><span className="tiny muted">Email them a link to fill in the {title.toLowerCase()} themselves.</span></span><Send size={16} />
    </button>
  );
  return (
    <section className="card col" style={{ gap: 10 }}>
      <b className="small">Email the customer a link</b>
      {res ? (
        <>
          <span className="small">{res.emailed ? <>Sent to <b>{email}</b>. It works for 30 days and comes back here when they finish.</> : <>Email isn&apos;t set up, so copy this link and text or email it to them:</>}</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input sm grow" readOnly value={res.url} onFocus={(e) => e.target.select()} aria-label="Form link" />
            <button type="button" className="btn sm dark" onClick={() => navigator.clipboard?.writeText(res.url)}><Copy size={14} /> Copy</button>
          </div>
        </>
      ) : (
        <>
          <div className="grid2">
            <label className="field"><span className="label">Their name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span className="label">Their email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </div>
          {err ? <span className="small red">{err}</span> : null}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" disabled={pending} onClick={() => go(async () => { setErr(""); const r = await sendFormLink({ key: formKey, email, name, prf, company, prefill }); if (r.ok) setRes(r); else setErr(r.error); })}><Send size={14} /> {pending ? "Sending…" : "Send the link"}</button>
            <button type="button" className="btn sm dark" onClick={() => setOpen(false)}>Fill it in here instead</button>
          </div>
        </>
      )}
    </section>
  );
}
