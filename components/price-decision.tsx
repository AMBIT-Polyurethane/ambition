"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Sparkles, X } from "lucide-react";
import { money, rate } from "@/lib/format";
import { decidePriceRequest, editPriceRequest } from "@/app/(app)/price-requests/native-actions";
import type { PrDetails } from "@/lib/pr-details";

type L = { id: number; name: string; sku: string; unit: string | null; list: number | null; requested: number; volume: string | null; status: string; approved: number | null; auto: boolean; rule: string | null; floor: number | null };

type Pick = { status: "approved" | "denied"; price: string };
const DETAIL_FIELDS: [keyof PrDetails, string, string?][] = [
  ["legal_name", "Customer"], ["contact_first", "Contact first name"], ["contact_last", "Contact last name"], ["phone", "Phone", "tel"], ["email", "Email", "email"],
  ["street", "Street"], ["city", "City"], ["state", "State"], ["zip", "ZIP"],
];

/**
 * Price approvers: approve each line as asked, at a different price, or say no.
 * With `edit`, the request was answered already: fix the details and change any price (rules-approved ones too).
 */
export function PriceDecision({ id, lines, edit }: { id: number; lines: L[]; edit?: { details: PrDetails; note: string } }) {
  const router = useRouter();
  const start = (l: L): Pick => ({ status: l.status === "denied" ? "denied" : "approved", price: String(l.approved ?? l.requested) });
  const [pick, setPick] = useState<Record<number, Pick>>(() => Object.fromEntries(lines.map((l) => [l.id, start(l)])));
  const [note, setNote] = useState(edit?.note ?? "");
  const [details, setDetails] = useState<PrDetails | null>(edit?.details ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const set = (lid: number, p: Partial<Pick>) => setPick((m) => ({ ...m, [lid]: { ...m[lid], ...p } }));
  const moved = (l: L) => {
    const a = start(l), b = pick[l.id];
    return a.status !== b.status || (b.status === "approved" && Number(a.price) !== Number(b.price));
  };
  const save = () =>
    go(async () => {
      setError(null);
      if (edit && details) {
        const answerChanged = lines.some(moved) || note.trim() !== edit.note.trim();
        const res = await editPriceRequest(
          id,
          details,
          answerChanged ? { lines: lines.filter((l) => !l.auto || moved(l)).map((l) => ({ id: l.id, ...pick[l.id] })), note } : null,
        );
        if (!res.ok) return setError(res.error);
        router.push(`/price-requests/n/${id}?msg=${encodeURIComponent(res.emailed ? "Changes saved. The rep was emailed the new prices." : "Changes saved.")}`);
        router.refresh();
        return;
      }
      const res = await decidePriceRequest(id, lines.filter((l) => !l.auto).map((l) => ({ id: l.id, ...pick[l.id] })), note);
      if (!res.ok) return setError(res.error);
      router.push(`/price-requests/n/${id}?msg=${encodeURIComponent("Saved. The rep was emailed.")}`);
      router.refresh();
    });
  const d = (k: keyof PrDetails, v: string) => setDetails((x) => (x ? { ...x, [k]: v } : x));
  return (
    <section className="col" style={{ gap: 10 }}>
      {details ? (
        <div className="card2 pr-edit">
          <div className="card2-h"><b>Customer &amp; request</b></div>
          <div className="card2-b col" style={{ gap: 12 }}>
          <div className="grid2">
            {DETAIL_FIELDS.map(([k, label, type]) => (
              <label key={k} className={`field${k === "legal_name" || k === "street" ? " span2" : ""}`}>
                <span className="label">{label}</span>
                <input className="input" type={type ?? "text"} value={details[k]} maxLength={200} onChange={(e) => d(k, e.target.value)} />
              </label>
            ))}
            <label className="field">
              <span className="label">Good through</span>
              <input className="input" type="date" value={details.valid_until} onChange={(e) => d("valid_until", e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="label">Rep&apos;s note</span>
            <textarea className="textarea" rows={2} value={details.note} maxLength={2000} onChange={(e) => d("note", e.target.value)} />
          </label>
          </div>
        </div>
      ) : null}
      {edit ? <b className="tg-h">Prices</b> : null}
      {lines.map((l) => {
        const p = pick[l.id];
        const off = l.list ? Math.round((1 - l.requested / l.list) * 1000) / 10 : null;
        const locked = l.auto && !edit;
        return (
          <div key={l.id} className={`card col pr-decide${locked ? " auto" : ""}${edit && moved(l) ? " moved" : ""}`} style={{ gap: 8 }}>
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
              <span><span className="tiny faint">Asked</span><b className={off !== null && off > 0 ? "red" : ""}>{rate(l.requested)}</b>{off !== null ? <span className="tiny faint">{off > 0 ? `${off}% under` : "at/above list"}</span> : null}</span>
            </div>
            {locked ? (
              <span className="tiny muted">Approved by the rules at {rate(l.approved ?? l.requested)}.</span>
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
      {edit ? (
        <>
          <div className="row" style={{ gap: 8 }}>
            <Link href={`/price-requests/n/${id}`} className="b2 quiet">Cancel</Link>
            <button type="button" className="btn grow" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save changes"}</button>
          </div>
          <p className="tiny faint center" style={{ margin: 0 }}>Changing a price or the note emails the rep. Fixing the details doesn&apos;t.</p>
        </>
      ) : (
        <button type="button" className="btn block" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save and email the rep"}</button>
      )}
    </section>
  );
}
