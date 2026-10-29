"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MapPin, Search, X } from "lucide-react";
import { Submit } from "@/components/forms";
import { addressLine, phoneText } from "@/lib/ops/crm";
import { searchCustomers, type CustomerHit } from "../../crm-actions";
import { createQuote } from "../actions";

/** Find the customer (name, phone, email or street), pick the job address, start. */
export function QuoteStart({ takeoffs, takeoffId, takeoffName }: { takeoffs: { id: string; name: string; customer: string | null }[]; takeoffId: string | null; takeoffName: string | null }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [cust, setCust] = useState<CustomerHit | null>(null);
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

  return (
    <form action={createQuote} className="card col" style={{ gap: 12 }}>
      {cust ? (
        <>
          <input type="hidden" name="customer_id" value={cust.id} />
          <div className="ops-picked">
            <span className="grow col tight" style={{ minWidth: 0 }}>
              <b className="ellipsis">{cust.name}</b>
              <span className="tiny faint ellipsis">{[phoneText(cust.phone), cust.email].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" className="iconbtn" aria-label="Pick someone else" onClick={() => setCust(null)}><X size={16} /></button>
          </div>
          {cust.properties.length ? (
            <label className="field">
              <span className="label">Job address</span>
              <select className="select" name="property_id" defaultValue={cust.properties[0].id}>
                {cust.properties.map((p) => <option key={p.id} value={p.id}>{addressLine(p) || p.label || "Address"}</option>)}
                <option value="">None yet</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            <span className="label">Job name (optional)</span>
            <input className="input" name="title" maxLength={140} placeholder="Attic and walls, new build lot 12…" />
          </label>
          {takeoffs.length ? (
            <label className="field">
              <span className="label">Fill it from a takeoff (optional)</span>
              <select className="select" name="takeoff_id" defaultValue={takeoffId ?? ""}>
                <option value="">No, I&apos;ll add the work myself</option>
                {takeoffs.map((t) => <option key={t.id} value={t.id}>{t.name}{t.customer ? ` · ${t.customer}` : ""}</option>)}
              </select>
            </label>
          ) : takeoffId ? <input type="hidden" name="takeoff_id" value={takeoffId} /> : null}
          {takeoffName ? <span className="tiny faint">From takeoff: {takeoffName}</span> : null}
          <Submit className="btn" pendingText="Starting…">Start the quote</Submit>
        </>
      ) : (
        <>
          <div className="search">
            <Search size={18} />
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, email or street" aria-label="Find the customer" autoFocus />
          </div>
          {hits.length ? (
            <div className="list">
              {hits.map((c) => (
                <button key={c.id} type="button" className="item" onClick={() => setCust(c)}>
                  <div className="grow" style={{ minWidth: 0, textAlign: "left" }}>
                    <div className="t ellipsis">{c.name}</div>
                    <div className="s ellipsis">{[phoneText(c.phone), c.properties[0] ? addressLine(c.properties[0]) : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  {c.properties.length ? <MapPin size={15} className="faint" /> : null}
                </button>
              ))}
            </div>
          ) : q.trim().length >= 2 ? (
            <span className="small muted">No match. New customers start as a lead: <a href="/ops/leads/new">add the lead</a>, then quote it.</span>
          ) : (
            <span className="tiny faint">Type at least 2 letters.</span>
          )}
        </>
      )}
    </form>
  );
}
