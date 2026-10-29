"use client";

import { useState } from "react";

// AMBIT-OPS: the "who and where" fields used on New customer and New lead.

export const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];

export function NameFields({ kind: k0 = "person", defaults = {} }: { kind?: "person" | "company"; defaults?: Partial<Record<"first_name" | "last_name" | "company_name", string>> }) {
  const [kind, setKind] = useState<"person" | "company">(k0);
  return (
    <>
      <input type="hidden" name="kind" value={kind} />
      <div className="seg" role="tablist" aria-label="Customer type">
        <button type="button" role="tab" aria-selected={kind === "person"} className={kind === "person" ? "on" : ""} onClick={() => setKind("person")}>Homeowner / person</button>
        <button type="button" role="tab" aria-selected={kind === "company"} className={kind === "company" ? "on" : ""} onClick={() => setKind("company")}>Builder / company</button>
      </div>
      {kind === "person" ? (
        <div className="grid2">
          <label className="field">
            <span className="label">First name</span>
            <input className="input" name="first_name" required defaultValue={defaults.first_name} autoComplete="off" autoCapitalize="words" />
          </label>
          <label className="field">
            <span className="label">Last name</span>
            <input className="input" name="last_name" defaultValue={defaults.last_name} autoComplete="off" autoCapitalize="words" />
          </label>
        </div>
      ) : (
        <label className="field">
          <span className="label">Company name</span>
          <input className="input" name="company_name" required defaultValue={defaults.company_name} autoComplete="off" autoCapitalize="words" placeholder="Smith Homes" />
        </label>
      )}
    </>
  );
}

export function ContactFields({ defaults = {} }: { defaults?: Partial<Record<"phone" | "email" | "phone2", string>> }) {
  return (
    <div className="grid2">
      <label className="field">
        <span className="label">Cell</span>
        <input className="input" name="phone" type="tel" inputMode="tel" defaultValue={defaults.phone} autoComplete="off" placeholder="(555) 555-5555" />
      </label>
      <label className="field">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" inputMode="email" defaultValue={defaults.email} autoComplete="off" placeholder="name@email.com" />
      </label>
    </div>
  );
}

export function AddressFields({ required, defaults = {}, prefix = "" }: { required?: boolean; prefix?: string; defaults?: Partial<Record<"street" | "city" | "state" | "zip" | "label" | "gate_code", string>> }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <label className="field">
        <span className="label">{prefix}Street address</span>
        <input className="input" name="street" required={required} defaultValue={defaults.street} autoComplete="off" placeholder="123 Main St" />
      </label>
      <div className="ops-addr">
        <label className="field">
          <span className="label">City</span>
          <input className="input" name="city" defaultValue={defaults.city} autoComplete="off" />
        </label>
        <label className="field">
          <span className="label">State</span>
          <select className="select input" name="state" defaultValue={defaults.state ?? ""}>
            <option value="">–</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">ZIP</span>
          <input className="input" name="zip" inputMode="numeric" defaultValue={defaults.zip} autoComplete="off" maxLength={10} />
        </label>
      </div>
    </div>
  );
}
