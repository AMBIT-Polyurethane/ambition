"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/** Customer Price Sheet: type part of a customer's name, account # or city, tap one. */
export function CustomerPick({ base, customers, value }: { base: string; customers: { id: string; name: string; account_no: string | null; city: string | null }[]; value: string | null }) {
  const router = useRouter();
  const current = customers.find((c) => c.id === value) ?? null;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(!current);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? customers.filter((c) => words.every((w) => `${c.name} ${c.account_no ?? ""} ${c.city ?? ""}`.toLowerCase().includes(w))) : customers;
    return hits.slice(0, 40);
  }, [q, customers]);
  if (!open && current) {
    return (
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="small"><b>{current.name}</b>{current.account_no ? ` · #${current.account_no}` : ""}{current.city ? ` · ${current.city}` : ""}</span>
        <button type="button" className="btn sm dark no-print" onClick={() => setOpen(true)}>Pick another customer</button>
      </div>
    );
  }
  return (
    <div className="col report-pick no-print" style={{ gap: 8 }}>
      <input className="input sm" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name, account # or city" aria-label="Find a customer" />
      <div className="list report-pick-list">
        {shown.map((c) => (
          <button key={c.id} type="button" className="item" onClick={() => { setOpen(false); router.push(`${base}?c=${c.id}`); }}>
            <div className="grow" style={{ minWidth: 0, textAlign: "left" }}>
              <span className="t ellipsis">{c.name}</span>
              <div className="s">{[c.account_no ? `#${c.account_no}` : "", c.city ?? ""].filter(Boolean).join(" · ")}</div>
            </div>
          </button>
        ))}
        {!shown.length ? <div className="item small muted">No customer matches “{q}”.</div> : null}
      </div>
    </div>
  );
}
