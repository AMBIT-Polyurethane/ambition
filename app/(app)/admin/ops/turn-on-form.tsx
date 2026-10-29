"use client";

import { useActionState, useState } from "react";
import { CircleCheck } from "lucide-react";
import { Submit } from "@/components/forms";
import { InviteShare } from "@/components/invite-form";
import type { InviteResult } from "@/lib/invites";
import { turnOn } from "./actions";

type Login = { id: string; full_name: string | null; email: string; phone: string | null };

/** Admin → AMBIT-OPS: pick the owner (one of the customer's logins, or invite someone) and turn it on. */
export function TurnOnForm({ companyId, logins }: { companyId: string; logins: Login[] }) {
  const [state, action] = useActionState<InviteResult, FormData>(turnOn, null);
  const [who, setWho] = useState<string>(logins[0]?.id ?? "new");
  if (state?.ok) {
    return (
      <div className="col" style={{ gap: 12 }}>
        <div className="alert ok" role="status">
          <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>AMBIT-OPS is on. <b>{state.name || state.email}</b> is the owner{state.existing ? " and can sign in now" : " as soon as they set their password"}.</span>
        </div>
        <InviteShare r={state} compact />
        <a href="/admin/ops" className="btn sm ghost" style={{ alignSelf: "flex-start" }}>Done</a>
      </div>
    );
  }
  return (
    <form action={action} className="col" style={{ gap: 12 }}>
      <input type="hidden" name="company_id" value={companyId} />
      <fieldset className="col" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Who is the owner?</legend>
        {logins.map((l) => (
          <label key={l.id} className="check">
            <input type="radio" name="pick" checked={who === l.id} onChange={() => setWho(l.id)} />
            <span>{l.full_name || l.email} <span className="tiny faint">{l.email}</span></span>
          </label>
        ))}
        <label className="check">
          <input type="radio" name="pick" checked={who === "new"} onChange={() => setWho("new")} />
          <span>Someone else: send them an invite</span>
        </label>
      </fieldset>
      {who === "new" ? (
        <div className="grid2">
          <label className="field">
            <span className="label">Owner&apos;s email</span>
            <input className="input" name="owner_email" type="email" required placeholder="owner@company.com" autoComplete="off" />
          </label>
          <label className="field">
            <span className="label">Name</span>
            <input className="input" name="owner_name" placeholder="Their name" autoComplete="off" />
          </label>
          <label className="field">
            <span className="label">Cell</span>
            <input className="input" name="owner_phone" inputMode="tel" placeholder="For texting the link" autoComplete="off" />
          </label>
        </div>
      ) : (
        <input type="hidden" name="owner_id" value={who} />
      )}
      {state && !state.ok ? <div className="alert err small" role="alert">{state.error}</div> : null}
      <Submit className="btn" pendingText="Turning on…">Turn on AMBIT-OPS</Submit>
    </form>
  );
}
