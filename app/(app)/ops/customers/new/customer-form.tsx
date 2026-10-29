"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createCustomer, type FormState } from "../../crm-actions";
import { AddressFields, ContactFields, NameFields } from "@/components/ops/customer-fields";
import { Submit } from "@/components/forms";

export function CustomerForm({ sources }: { sources: string[] }) {
  const [state, action] = useActionState<FormState, FormData>(createCustomer, null);
  const [confirmDup, setConfirmDup] = useState(false);
  const [then, setThen] = useState(true);
  return (
    <form action={action} className="col" style={{ gap: 16 }}>
      <section className="card col" style={{ gap: 12 }}>
        <NameFields />
        <ContactFields />
        <AddressFields />
      </section>
      <section className="card col" style={{ gap: 12 }}>
        <div className="grid2">
          <label className="field">
            <span className="label">How they found you</span>
            <select className="select" name="source" defaultValue="">
              <option value="">Pick one</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Prices</span>
            <select className="select" name="price_level" defaultValue="retail">
              <option value="retail">Retail</option>
              <option value="builder">Builder</option>
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" name="tax_exempt" /> Tax exempt</label>
        <label className="field">
          <span className="label">Notes</span>
          <textarea className="textarea" name="customer_notes" rows={2} maxLength={2000} placeholder="Anything the team should know" />
        </label>
      </section>
      {state?.dup ? (
        <div className="alert warn small" role="alert" style={{ flexDirection: "column", gap: 8 }}>
          <span>{state.error}</span>
          <span className="row wrap" style={{ gap: 10, alignItems: "center" }}>
            <Link href={`/ops/customers/${state.dup.id}`} className="btn sm dark">Open {state.dup.name}</Link>
            <label className="check small"><input type="checkbox" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} /> It&apos;s someone else: add anyway</label>
          </span>
        </div>
      ) : state?.error ? (
        <div className="alert err small" role="alert">{state.error}</div>
      ) : null}
      <input type="hidden" name="confirm_dup" value={confirmDup ? "1" : ""} />
      <input type="hidden" name="then" value={then ? "lead" : ""} />
      <label className="check"><input type="checkbox" checked={then} onChange={(e) => setThen(e.target.checked)} /> Start a lead for them next</label>
      <Submit className="btn block" pendingText="Saving…">Add customer</Submit>
    </form>
  );
}
