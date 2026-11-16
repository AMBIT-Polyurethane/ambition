"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Submit } from "@/components/forms";
import { placeHold } from "@/app/(app)/inventory/hold-actions";

// Hold a lot for a customer (0071): which lot, who for, how many (all that's free unless you say), until when.

export type HoldLot = { id: number; sku: string; name: string; lot_no: string | null; use_by: string | null; free: number; expired: boolean };
export type HoldCustomer = { id: string; name: string; account_no: string | null; city: string | null; state: string | null };

const q2 = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const md = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}` : null);

export function HoldForm({
  branch,
  lots,
  customers,
  lot: lot0,
  company: company0,
  until,
  min,
  max,
}: {
  branch: string;
  lots: HoldLot[];
  customers: HoldCustomer[];
  lot?: number | null;
  company?: string | null;
  until: string;
  min: string;
  max: string;
}) {
  const [lot, setLot] = useState<string>(lot0 && lots.some((l) => l.id === lot0) ? String(lot0) : "");
  const [company, setCompany] = useState<string>(company0 && customers.some((c) => c.id === company0) ? company0 : "");
  const [find, setFind] = useState("");
  const chosen = lots.find((l) => String(l.id) === lot) ?? null;
  const who = customers.find((c) => c.id === company) ?? null;

  // Lots grouped by product, in the order they come (FOAM LOTS order).
  const groups = useMemo(() => {
    const m = new Map<string, HoldLot[]>();
    for (const l of lots) m.set(`${l.name} (${l.sku})`, [...(m.get(`${l.name} (${l.sku})`) ?? []), l]);
    return [...m.entries()];
  }, [lots]);
  const matches = useMemo(() => {
    const words = find.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return customers
      .filter((c) => words.every((w) => `${c.name} ${c.account_no ?? ""} ${c.city ?? ""} ${c.state ?? ""}`.toLowerCase().includes(w)))
      .slice(0, 8);
  }, [customers, find]);

  return (
    <form action={placeHold} className="hold-form">
      <input type="hidden" name="branch" value={branch} />
      <input type="hidden" name="company" value={company} />
      <input type="hidden" name="free" value={chosen ? chosen.free : 0} />

      <label className="field">
        <span className="label">Lot</span>
        <select className="select" name="lot" value={lot} onChange={(e) => setLot(e.target.value)} required>
          <option value="">Pick the lot…</option>
          {groups.map(([g, list]) => (
            <optgroup key={g} label={g}>
              {list.map((l) => (
                <option key={l.id} value={l.id} disabled={l.free <= 0}>
                  {`Lot ${l.lot_no || "(no lot #)"} · ${l.free > 0 ? `${q2(l.free)} free` : "none free"}${l.use_by ? ` · use by ${md(l.use_by)}` : ""}${l.expired ? " · EXPIRED" : ""}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="label">Customer</span>
        {who ? (
          <div className="hold-who">
            <b>{who.name}</b>
            <span className="tiny faint">{[who.account_no ? `Acct ${who.account_no}` : null, who.city && who.state ? `${who.city}, ${who.state}` : null].filter(Boolean).join(" · ")}</span>
            <button type="button" className="iconbtn sm" onClick={() => setCompany("")} aria-label="Pick a different customer"><X size={15} /></button>
          </div>
        ) : (
          <div className="hold-find">
            <div className="search">
              <Search size={16} />
              <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type part of the customer's name, account # or city" aria-label="Find the customer" />
            </div>
            {matches.length ? (
              <div className="hold-matches" role="listbox">
                {matches.map((c) => (
                  <button key={c.id} type="button" role="option" aria-selected={false} onClick={() => (setCompany(c.id), setFind(""))}>
                    <b>{c.name}</b>
                    <span className="tiny faint">{[c.account_no, c.city && c.state ? `${c.city}, ${c.state}` : null].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
              </div>
            ) : find.trim() ? <span className="tiny faint">No customer matches that.</span> : null}
          </div>
        )}
      </div>

      <div className="hold-row">
        <label className="field">
          <span className="label">How many</span>
          <input className="input" name="qty" inputMode="decimal" placeholder={chosen ? `All ${q2(chosen.free)}` : "All that's free"} autoComplete="off" />
        </label>
        <label className="field">
          <span className="label">Hold until</span>
          <input className="input" type="date" name="until" defaultValue={until} min={min} max={max} required />
        </label>
      </div>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input className="input" name="note" maxLength={300} placeholder="ProSeal will buy these, per Kim" />
      </label>
      {lot && company ? (
        <Submit className="btn" pendingText="Holding…">{who ? `Hold for ${who.name}` : "Hold"}</Submit>
      ) : (
        <button type="button" className="btn" disabled>Pick the lot and the customer</button>
      )}
    </form>
  );
}
