"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, CircleAlert, CircleCheck, LoaderCircle, Repeat, Search, X } from "lucide-react";
import { fixLotDates, switchLot } from "@/app/(app)/inventory/lot-actions";

export type ChangeLot = {
  id: number; product_id: string; sku: string; name: string; unit: string | null; lot_no: string | null;
  mfg: string | null; exp: string | null; expired: boolean; left: number; busy: number; free: number;
  /** Just made in the app; the sync adds its row to FOAM LOTS. */
  adding?: boolean;
};
export type ChangeProduct = { id: string; sku: string; name: string; unit: string | null };
export type LotChange = {
  id: number; kind: "product" | "dates"; lot_no: string | null; from_sku: string | null; to_sku: string | null; qty: number | null;
  old_exp: string | null; new_exp: string | null; old_mfg: string | null; new_mfg: string | null; note: string | null; by_name: string | null; created_at: string;
};

const q2 = (n: number) => String(Math.round(n * 100) / 100);
const us = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "–");
const isIso = (sku: string) => /ISO/i.test(sku);
const key = (lot: string | null) => (lot ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The lots at one location, each with Change: move drums to another product, or fix the dates. */
export function LotChanger({ branchName, lots, products, canChange, pick }: { branchName: string; lots: ChangeLot[]; products: ChangeProduct[]; canChange: boolean; pick: number | null }) {
  const router = useRouter();
  const [find, setFind] = useState("");
  const [empty, setEmpty] = useState(false);
  const [open, setOpen] = useState<number | null>(pick);
  const [mode, setMode] = useState<"product" | "dates">("product");
  const [qty, setQty] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [exp, setExp] = useState("");
  const [mfg, setMfg] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();

  const t = find.trim().toLowerCase();
  const shown = lots.filter((l) => (empty || l.left !== 0 || l.id === open) && (!t || `${l.sku} ${l.name} ${l.lot_no ?? ""}`.toLowerCase().includes(t)));
  const groups = useMemo(() => {
    const m = new Map<string, ChangeLot[]>();
    for (const l of shown) m.set(l.product_id, [...(m.get(l.product_id) ?? []), l]);
    return [...m.values()];
  }, [shown]);

  const cur = lots.find((l) => l.id === open) ?? null;
  const targets = cur ? products.filter((p) => p.id !== cur.product_id && (p.unit ?? "").toLowerCase() === (cur.unit ?? "").toLowerCase() && isIso(p.sku) === isIso(cur.sku)) : [];
  const target = targets.find((p) => p.id === to) ?? null;
  const sameLot = (pid: string) => (cur ? lots.find((l) => l.product_id === pid && key(l.lot_no) === key(cur.lot_no) && key(cur.lot_no) !== "") ?? null : null);
  const rowsOfLot = cur && key(cur.lot_no) ? lots.filter((l) => key(l.lot_no) === key(cur.lot_no)).length : 1;
  const n = Number(qty.replace(/,/g, ""));

  const start = (l: ChangeLot, m: "product" | "dates") => {
    setOpen(l.id); setMode(m); setMsg(null); setNote("");
    setQty(l.free ? q2(l.free) : ""); setExp(l.exp ?? ""); setMfg(l.mfg ?? "");
    const alpha = products.filter((p) => p.id !== l.product_id && (p.unit ?? "").toLowerCase() === (l.unit ?? "").toLowerCase() && isIso(p.sku) === isIso(l.sku));
    setTo((alpha.find((p) => /^ALPHA/i.test(p.sku)) ?? alpha[0])?.id ?? "");
  };
  const save = () =>
    go(async () => {
      if (!cur) return;
      setMsg(null);
      const r = mode === "product"
        ? await switchLot({ lot: cur.id, qty, product: to, note })
        : await fixLotDates({ lot: cur.id, exp: exp !== (cur.exp ?? "") ? exp : "", mfg: mfg !== (cur.mfg ?? "") ? mfg : "", note });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: r.msg });
      setOpen(null);
      router.refresh();
    });

  const panel = (l: ChangeLot) => (
    <div className="lotchg-panel" role="region" aria-label={`Change lot ${l.lot_no ?? ""}`}>
      <div className="row between" style={{ gap: 8 }}>
        <div className="seg sm" role="radiogroup" aria-label="What to change">
          <button type="button" className={mode === "product" ? "on" : ""} aria-pressed={mode === "product"} onClick={() => start(l, "product")}><Repeat size={15} /> Change product</button>
          <button type="button" className={mode === "dates" ? "on" : ""} aria-pressed={mode === "dates"} onClick={() => start(l, "dates")}><CalendarDays size={15} /> Fix dates</button>
        </div>
        <button type="button" className="iconbtn" aria-label="Close" onClick={() => setOpen(null)}><X size={18} /></button>
      </div>
      {mode === "product" ? (
        <>
          <div className="lotchg-grid">
            <label className="field"><span className="label">How many {l.unit ?? "drum"}s</span>
              <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
              <span className="tiny faint">{q2(l.free)} free{l.busy ? ` (${q2(l.busy)} more are on open orders or held)` : ""}</span>
            </label>
            <label className="field"><span className="label">Change to</span>
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                {targets.length ? null : <option value="">No product to change to here</option>}
                {targets.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
              </select>
              <span className="tiny faint">{isIso(l.sku) ? "ISO changes only to another ISO." : "Resin changes only to another resin."}</span>
            </label>
            <label className="field lotchg-why"><span className="label">Why</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={target && /^ALPHA/i.test(target.sku) ? `Sold as ${target.name}` : "What happened"} />
            </label>
          </div>
          {target && n > 0 ? (
            <div className="lotchg-preview" aria-live="polite">
              <span><b>{l.sku}</b> lot {l.lot_no ?? "(no lot #)"}: {q2(l.left)} <ArrowRight size={13} aria-hidden /> <b>{q2(l.left - n)}</b></span>
              <span><b>{target.sku}</b> lot {l.lot_no ?? "(no lot #)"}: {q2(sameLot(target.id)?.left ?? 0)} <ArrowRight size={13} aria-hidden /> <b>{q2((sameLot(target.id)?.left ?? 0) + n)}</b>{sameLot(target.id) ? "" : " (new row on FOAM LOTS)"}</span>
              <span className="tiny faint">Expires {us(l.exp)}. Same lot #, same dates.</span>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="lotchg-grid">
            <label className="field"><span className="label">Expires</span><input className="input" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
            <label className="field"><span className="label">Made on</span><input className="input" type="date" value={mfg} onChange={(e) => setMfg(e.target.value)} /></label>
            <label className="field lotchg-why"><span className="label">Why (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Typed wrong on the sheet" /></label>
          </div>
          <span className="tiny faint">
            {rowsOfLot > 1 ? `Lot ${l.lot_no} is on ${rowsOfLot} rows here (different products). All ${rowsOfLot} get the new date.` : "The new date goes onto FOAM LOTS."}
          </span>
        </>
      )}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={pending || (mode === "product" ? !(n > 0 && n <= l.free && to && note.trim().length > 2) : !((exp && exp !== (l.exp ?? "")) || (mfg && mfg !== (l.mfg ?? ""))))} onClick={save}>
          {pending ? <LoaderCircle size={16} className="spin" /> : mode === "product" ? <Repeat size={16} /> : <CalendarDays size={16} />} {mode === "product" ? "Move the drums" : "Save the dates"}
        </button>
        {mode === "product" && n > l.free ? <span className="small err-text">Only {q2(l.free)} free on this lot.</span> : null}
      </div>
    </div>
  );

  return (
    <section className="card col" style={{ gap: 10 }} aria-label="Lots">
      <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
        <b>Lots on FOAM LOTS · {branchName}</b>
        <label className="check small"><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Show empty lots</label>
      </div>
      <div className="search" style={{ position: "relative" }}>
        <Search size={17} />
        <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a lot # or product" aria-label="Find a lot" />
      </div>
      {msg ? (
        <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />}<span>{msg.text}</span>
        </div>
      ) : null}
      {groups.length ? groups.map((g) => (
        <div key={g[0].product_id} className="lotchg-group">
          <div className="lotchg-gh"><b>{g[0].name}</b><span className="tiny faint">{g[0].sku} · {q2(g.reduce((s, l) => s + l.left, 0))} on hand</span></div>
          {g.map((l) => (
            <div key={l.id} className={`lotchg-row${open === l.id ? " on" : ""}`}>
              <div className="lotchg-line">
                <span className="lotchg-lot"><b>{l.lot_no ?? "(no lot #)"}</b><span className={`tiny ${l.expired ? "err-text" : "faint"}`}>Expires {us(l.exp)}{l.expired ? " · expired" : ""}{l.adding ? " · being added to FOAM LOTS" : ""}</span></span>
                <span className="lotchg-n"><b>{q2(l.left)}</b><span className="tiny faint">on hand</span></span>
                <span className="lotchg-n"><b>{q2(l.free)}</b><span className="tiny faint">free</span></span>
                {canChange && !l.adding ? (
                  <span className="lotchg-acts">
                    <button type="button" className="b2 quiet sm" onClick={() => start(l, "product")} disabled={!l.free}><Repeat size={14} /> Change product</button>
                    <button type="button" className="b2 quiet sm" onClick={() => start(l, "dates")}><CalendarDays size={14} /> Dates</button>
                  </span>
                ) : null}
              </div>
              {open === l.id && canChange ? panel(l) : null}
            </div>
          ))}
        </div>
      )) : <p className="small muted" style={{ margin: 0 }}>No lots match.</p>}
    </section>
  );
}
