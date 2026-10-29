"use client";

import { useActionState, useState } from "react";
import { Check, CircleCheck } from "lucide-react";
import { Submit } from "@/components/forms";
import { STATES } from "@/components/ops/customer-fields";
import { submitLeadRequest, type LeadFormState } from "./actions";

export function LeadRequestForm({ token, services, company }: { token: string; services: string[]; company: string }) {
  const [state, action] = useActionState<LeadFormState, FormData>(submitLeadRequest, null);
  const [picked, setPicked] = useState<string[]>([]);
  if (state?.ok) {
    return (
      <div className="card col center" style={{ gap: 10, padding: "28px 18px" }}>
        <div className="done-mark" style={{ margin: "0 auto" }}><CircleCheck size={36} /></div>
        <h2 className="h2" style={{ margin: 0 }}>Thanks! Your request is in.</h2>
        <span className="muted">{company} will reach out soon about your project.</span>
      </div>
    );
  }
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <input type="hidden" name="token" value={token} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
      <label className="field">
        <span className="label">Your name</span>
        <input className="input" name="name" required autoComplete="name" />
      </label>
      <div className="grid2">
        <label className="field">
          <span className="label">Phone</span>
          <input className="input" name="phone" type="tel" inputMode="tel" autoComplete="tel" />
        </label>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" name="email" type="email" autoComplete="email" />
        </label>
      </div>
      <label className="field">
        <span className="label">Project address</span>
        <input className="input" name="street" autoComplete="street-address" placeholder="Street" />
      </label>
      <div className="ops-addr">
        <input className="input" name="city" autoComplete="address-level2" placeholder="City" aria-label="City" />
        <select className="select" name="state" autoComplete="address-level1" defaultValue="" aria-label="State">
          <option value="">State</option>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="input" name="zip" inputMode="numeric" autoComplete="postal-code" placeholder="ZIP" aria-label="ZIP" maxLength={10} />
      </div>
      {services.length ? (
        <div className="col" style={{ gap: 8 }}>
          <span className="label">What do you need?</span>
          <div className="chips wrap">
            {services.map((sv) => {
              const on = picked.includes(sv);
              return (
                <label key={sv} className={`chip lead-chip${on ? " on" : ""}`}>
                  <input type="checkbox" name="services" value={sv} checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== sv) : [...p, sv]))} hidden />
                  {on ? <Check size={14} /> : null} {sv}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      <label className="field">
        <span className="label">Tell them about the project</span>
        <textarea className="textarea" name="message" rows={4} maxLength={2000} placeholder="New build or existing home, attic or walls, square footage, timing…" />
      </label>
      {state && !state.ok ? <div className="alert err small" role="alert">{state.error}</div> : null}
      <Submit className="btn block lead-submit" pendingText="Sending…">Send my request</Submit>
    </form>
  );
}
