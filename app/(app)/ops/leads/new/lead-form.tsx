"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, MapPin, Search, UserPlus, X } from "lucide-react";
import { createLead, getCustomer, searchCustomers, type CustomerHit, type FormState } from "../../crm-actions";
import { AddressFields, ContactFields, NameFields } from "@/components/ops/customer-fields";
import { Submit } from "@/components/forms";
import { addressLine, phoneText } from "@/lib/ops/crm";

type Opt = { id: string; name: string };

/** New lead: an existing customer (type to find them) or a new one, where the job is, and what they need. */
export function LeadForm({
  customer: initial, propertyId, services, sources, reps, me, defaultRep, locations,
}: {
  customer: CustomerHit | null; propertyId: string | null; services: string[]; sources: string[]; reps: Opt[]; me: string; defaultRep: string; locations: Opt[];
}) {
  const [state, action] = useActionState<FormState, FormData>(createLead, null);
  const [mode, setMode] = useState<"find" | "new">(initial ? "find" : "new");
  const [cust, setCust] = useState<CustomerHit | null>(initial);
  const [prop, setProp] = useState<string>(propertyId ?? initial?.properties[0]?.id ?? "new");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmDup, setConfirmDup] = useState(false);
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => start(async () => setHits(await searchCustomers(q))), 220);
  }, [q]);

  const choose = (c: CustomerHit) => {
    setCust(c);
    setProp(c.properties[0]?.id ?? "new");
    setHits([]);
    setQ("");
  };

  return (
    <form action={action} className="col" style={{ gap: 16 }}>
      <section className="card col" style={{ gap: 12 }}>
        <div className="row between">
          <b>Customer</b>
          <div className="chips">
            <button type="button" className={`chip sm${mode === "find" ? " on" : ""}`} onClick={() => setMode("find")}><Search size={14} /> Existing</button>
            <button type="button" className={`chip sm${mode === "new" ? " on" : ""}`} onClick={() => { setMode("new"); setCust(null); }}><UserPlus size={14} /> New</button>
          </div>
        </div>
        {mode === "find" ? (
          cust ? (
            <>
              <input type="hidden" name="customer_id" value={cust.id} />
              <div className="ops-picked">
                <span className="col tight grow" style={{ minWidth: 0 }}>
                  <b className="ellipsis">{cust.name}</b>
                  <span className="tiny faint ellipsis">{[phoneText(cust.phone), cust.email].filter(Boolean).join(" · ") || "No phone or email yet"}</span>
                </span>
                <button type="button" className="iconbtn sm" aria-label="Pick someone else" onClick={() => setCust(null)}><X size={16} /></button>
              </div>
              <fieldset className="col" style={{ gap: 8, border: 0, margin: 0, padding: 0 }}>
                <legend className="label" style={{ marginBottom: 6 }}>Job address</legend>
                {cust.properties.map((p) => (
                  <label key={p.id} className="check">
                    <input type="radio" name="property_pick" checked={prop === p.id} onChange={() => setProp(p.id)} />
                    <span><MapPin size={13} style={{ verticalAlign: -2 }} /> {p.label ? `${p.label}: ` : ""}{addressLine(p)}</span>
                  </label>
                ))}
                <label className="check">
                  <input type="radio" name="property_pick" checked={prop === "new"} onChange={() => setProp("new")} />
                  <span>{cust.properties.length ? "A different address" : "Add the job address"}</span>
                </label>
              </fieldset>
              {prop === "new" ? <AddressFields /> : <input type="hidden" name="property_id" value={prop} />}
            </>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              <div className="search">
                <Search size={18} />
                <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, email or street" aria-label="Find a customer" autoFocus />
              </div>
              {hits.length ? (
                <div className="list">
                  {hits.map((c) => (
                    <button key={c.id} type="button" className="item" onClick={() => choose(c)} style={{ textAlign: "left" }}>
                      <div className="grow">
                        <div className="t ellipsis">{c.name}</div>
                        <div className="s ellipsis">{[phoneText(c.phone), addressLine(c.properties[0])].filter(Boolean).join(" · ") || c.email}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : q.trim().length >= 2 ? (
                <span className="small muted">No match. <button type="button" className="linkbtn small" onClick={() => setMode("new")}>Add them as a new customer</button></span>
              ) : null}
            </div>
          )
        ) : (
          <>
            <NameFields />
            <ContactFields />
            <AddressFields prefix="Job " />
            {state?.dup ? (
              <div className="alert warn small" role="alert" style={{ flexDirection: "column", gap: 8 }}>
                <span>{state.error}</span>
                <span className="row wrap" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="btn sm dark"
                    onClick={() => start(async () => {
                      const c = await getCustomer(state.dup!.id);
                      if (c) {
                        setMode("find");
                        choose(c);
                      }
                    })}
                  >
                    Use {state.dup.name}
                  </button>
                  <label className="check small"><input type="checkbox" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} /> It&apos;s someone else: add anyway</label>
                </span>
              </div>
            ) : null}
            <input type="hidden" name="confirm_dup" value={confirmDup ? "1" : ""} />
          </>
        )}
      </section>

      <section className="card col" style={{ gap: 12 }}>
        <b>What they need</b>
        <div className="chips wrap">
          {services.map((s) => {
            const on = picked.includes(s);
            return (
              <label key={s} className={`chip${on ? " on" : ""}`}>
                <input type="checkbox" name="services" value={s} checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== s) : [...p, s]))} hidden />
                {on ? <Check size={14} /> : null} {s}
              </label>
            );
          })}
        </div>
        <label className="field">
          <span className="label">Job name (optional)</span>
          <input className="input" name="title" maxLength={140} placeholder="Attic and walls, new build lot 12…" autoComplete="off" />
        </label>
        <div className="grid2">
          <label className="field">
            <span className="label">Where the lead came from</span>
            <select className="select input" name="lead_source" defaultValue="">
              <option value="">Pick one</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Sales rep</span>
            <select className="select input" name="rep_id" defaultValue={defaultRep}>
              <option value="">Not assigned yet</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.name}{r.id === me ? " (me)" : ""}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Rough job value (optional)</span>
            <input className="input" name="value_est" inputMode="decimal" placeholder="$" autoComplete="off" />
          </label>
          <label className="field">
            <span className="label">Follow up on</span>
            <input className="input" type="date" name="next_at" />
          </label>
          {locations.length > 1 ? (
            <label className="field">
              <span className="label">Location</span>
              <select className="select input" name="location_id" defaultValue={locations[0].id}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <label className="field">
          <span className="label">Notes</span>
          <textarea className="textarea" name="notes" rows={3} maxLength={4000} placeholder="What they asked for, best time to call, gate code…" />
        </label>
      </section>

      {state?.error && !state.dup ? <div className="alert err small" role="alert">{state.error}</div> : null}
      <Submit className="btn block" pendingText="Saving…">Add lead</Submit>
    </form>
  );
}
