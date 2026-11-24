"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { saveTaxRate } from "@/app/(app)/estimates/actions";
import type { TaxRate } from "@/lib/estimates";

type Kind = TaxRate["kind"];
const KIND: Record<Kind, string> = { branch: "AMBIT location (pickups)", zip: "ZIP (deliveries)", state: "State (deliveries, any ZIP without its own rate)" };

/**
 * The sales tax rates estimates use: a pickup takes its AMBIT location's rate; a delivery takes its ZIP's rate, else
 * its state's. Accounting and admins keep them; a CRM can still type a different rate on one estimate.
 */
export function TaxRates({ rates, branches, canEdit }: { rates: TaxRate[]; branches: { id: string; name: string; state: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("branch");
  const [key, setKey] = useState("");
  const [rate, setRate] = useState("");
  const [onFreight, setOnFreight] = useState(true);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const branchName = new Map(branches.map((b) => [b.id, `${b.name}, ${b.state}`]));
  const missing = branches.filter((b) => !rates.some((r) => r.kind === "branch" && r.key === b.id));

  const save = (p: { kind: Kind; key: string; rate: string; tax_freight: boolean; label: string }, done: string) =>
    go(async () => {
      setMsg(null);
      const r = await saveTaxRate(p);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: done });
      setKey("");
      setRate("");
      setLabel("");
      router.refresh();
    });
  const edit = (r: TaxRate) => {
    setKind(r.kind);
    setKey(r.key);
    setRate(String(Number(r.rate)));
    setOnFreight(r.tax_freight);
    setLabel(r.label ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      {canEdit ? (
        <section className="card col" style={{ gap: 10 }}>
          <b>Add or change a rate</b>
          <div className="grid2">
            <label className="field">
              <span className="label">For</span>
              <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setKey(""); }}>
                {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">{kind === "branch" ? "Location" : kind === "zip" ? "ZIP" : "State"}</span>
              {kind === "branch" ? (
                <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
                  <option value="">Pick the location…</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}, {b.state}</option>)}
                </select>
              ) : (
                <input className="input" value={key} onChange={(e) => setKey(kind === "state" ? e.target.value.toUpperCase().slice(0, 2) : e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder={kind === "zip" ? "74103" : "OK"} inputMode={kind === "zip" ? "numeric" : "text"} />
              )}
            </label>
            <label className="field">
              <span className="label">Rate %</span>
              <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="8.625" />
            </label>
            <label className="field">
              <span className="label">Label (optional)</span>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="City + county + state" />
            </label>
          </div>
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={onFreight} onChange={(e) => setOnFreight(e.target.checked)} /> Freight is taxed here too
          </label>
          {msg ? <div className={`alert ${msg.ok ? "ok" : "err"} small`}>{msg.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}<span>{msg.text}</span></div> : null}
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={pending || !key || !rate.trim()} onClick={() => save({ kind, key, rate, tax_freight: onFreight, label }, "Saved. New estimates use it (open ones when they're priced again).")}>
            {pending ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />} Save rate
          </button>
        </section>
      ) : (
        <div className="alert small"><span>Accounting and admins keep these rates. A CRM can type a different rate on one estimate.</span></div>
      )}
      {missing.length ? (
        <div className="alert warn small"><CircleAlert size={16} /><span>No rate yet for pickups at {missing.map((b) => b.name).join(", ")}. Their estimates show &quot;No rate&quot; until one is added (or a CRM types one).</span></div>
      ) : null}
      <div className="cr-wrap card" style={{ padding: 0 }}>
        <table className="cr-table">
          <thead>
            <tr><th>For</th><th>Rate</th><th>Freight taxed</th><th>Label</th><th>Changed</th><th /></tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.kind === "branch" ? `Pickup: ${branchName.get(r.key) ?? r.key}` : r.kind === "zip" ? `ZIP ${r.key}` : `State of ${r.key}`}</b>
                </td>
                <td>{Number(r.rate)}%</td>
                <td>{r.tax_freight ? "Yes" : "No"}</td>
                <td style={{ textAlign: "left" }}>{r.label ?? ""}</td>
                <td className="tiny faint">{r.updated_by_name ?? ""}</td>
                <td>
                  {canEdit ? (
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      <button type="button" className="linkbtn small" onClick={() => edit(r)}>Change</button>
                      <button type="button" className="iconbtn" aria-label="Remove this rate" disabled={pending} onClick={() => save({ kind: r.kind, key: r.key, rate: "", tax_freight: r.tax_freight, label: "" }, "Removed.")}><Trash2 size={15} /></button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rates.length ? <tr><td colSpan={6} className="small muted" style={{ textAlign: "center", padding: 20 }}>No tax rates yet. Add each AMBIT location&apos;s, then the states you deliver to.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
