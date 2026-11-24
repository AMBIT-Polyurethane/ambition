"use client";

import { useState, useTransition } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { handOverOwner } from "./actions";

/** "Hand the login to Nick": the owner makes a password only they know. */
export function HandOver({ slug, owner, email }: { slug: string; owner: string; email: string }) {
  const [pending, run] = useTransition();
  const [sure, setSure] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const first = owner.split(/\s+/)[0];
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="small muted">
        If anyone at AMBIT has used this login (a test or a demo), hand it over: {first} gets an email at {email} to make a password only {first} knows. The old password stops working right away.
      </span>
      {sure ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn sm" disabled={pending} onClick={() => run(async () => { const r = await handOverOwner(slug); setRes(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); setSure(false); })}>
            {pending ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} aria-hidden="true" />} Yes, reset it and email {first}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setSure(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { setRes(null); setSure(true); }}>
          <KeyRound size={16} aria-hidden="true" /> Hand the login to {first}
        </button>
      )}
      {res ? <div className={`alert ${res.ok ? "ok" : "err"} small`} style={{ margin: 0 }}>{res.text}</div> : null}
    </div>
  );
}
