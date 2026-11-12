"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Sparkles, X } from "lucide-react";
import { money } from "@/lib/format";
import { decidePriceRequest } from "@/app/(app)/price-requests/native-actions";

type L = { id: number; name: string; sku: string; unit: string | null; list: number | null; requested: number; volume: string | null; status: string; approved: number | null; auto: boolean; rule: string | null; floor: number | null };

/** Price approvers: approve each line as asked, at a different price, or say no. */
export function PriceDecision({ id, lines }: { id: number; lines: L[] }) {
  const router = useRouter();
  const [pick, setPick] = useState<Record<number, { status: "approved" | "denied"; price: string }>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { status: l.status === "denied" ? "denied" : "approved", price: String(l.approved ?? l.requested) }])),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const set = (lid: number, p: Partial<{ status: "approved" | "denied"; price: string }>) => setPick((m) => ({ ...m, [lid]: { ...m[lid], ...p } }));
  const save = () =>
    go(async () => {
      setError(null);
      const res = await decidePriceRequest(id, lines.filter((l) => !l.auto).map((l) => ({ id: l.id, ...pick[l.id] })), note);
      if (!res.ok) return setError(res.error);
      router.push(`/price-requests/n/${id}?msg=${encodeURIComponent("Saved. The rep was emailed.")}`);
      router.refresh();
    });
  return (
    <section className="col" style={{ gap: 10 }}>
      {lines.map((l) => {
        const p = pick[l.id];
        const off = l.list ? Math.round((1 - l.requested / l.list) * 1000) / 10 : null;
        return (
          <div key={l.id} className={`card col pr-decide${l.auto ? " auto" : ""}`} style={{ gap: 8 }}>
            <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
              <div className="col tight" style={{ minWidth: 0 }}>
                <b>{l.name}</b>
                <span className="tiny faint">{l.sku}{l.volume ? ` · ${l.volume}` : ""}</span>
              </div>
              {l.auto ? <span className="pill ok"><Sparkles size={11} /> {l.rule}</span> : null}
            </div>
            <div className="pr-nums">
              <span><span className="tiny faint">List</span><b>{l.list !== null ? money(l.list) : "–"}</b></span>
              <span><span className="tiny faint">Floor</span><b>{l.floor !== null ? money(l.floor) : "–"}</b></span>
              <span><span className="tiny faint">Asked</span><b className={off !== null && off > 0 ? "red" : ""}>{money(l.requested)}</b>{off !== null ? <span className="tiny faint">{off > 0 ? `${off}% under` : "at/above list"}</span> : null}</span>
            </div>
            {l.auto ? (
              <span className="tiny muted">Approved by the rules at {money(l.approved ?? l.requested)}.</span>
            ) : (
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div className="seg" role="radiogroup" aria-label={`Decision for ${l.name}`}>
                  <button type="button" className={p.status === "approved" ? "on" : ""} onClick={() => set(l.id, { status: "approved" })}><Check size={14} /> Approve</button>
                  <button type="button" className={p.status === "denied" ? "on" : ""} onClick={() => set(l.id, { status: "denied" })}><X size={14} /> No</button>
                </div>
                {p.status === "approved" ? (
                  <label className="row" style={{ gap: 6, alignItems: "center" }}>
                    <span className="tiny muted">at</span>
                    <input className="input sm" style={{ width: 110 }} inputMode="decimal" value={p.price} onChange={(e) => set(l.id, { price: e.target.value.replace(/[^\d.]/g, "") })} aria-label={`Approved price for ${l.name}`} />
                    <span className="tiny faint">/ {l.unit ?? "each"}</span>
                  </label>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      <label className="field">
        <span className="label">Note for the rep (optional)</span>
        <textarea className="textarea" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Good through Q1; needs 6 sets a month to hold this price" />
      </label>
      {error ? <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div> : null}
      <button type="button" className="btn block" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save and email the rep"}</button>
    </section>
  );
}
