"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { fmt, isFoam, setsFromLbs } from "@/lib/ops/field/calc";
import type { FieldProduct, FieldTrip, Mat, MatOp, StockLot } from "@/lib/ops/field/types";
import { nowIso, useField, uuid } from "./bits";

const MAKERS = ["Covestro", "Wanhua", "Huntsman", "BASF", "Other"];
const family = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/-W$/, "");
const lotKey = (l: StockLot) => `${l.item_key}|${l.maker}|${l.lot_no}`;
const where = (l: StockLot, rig: string | undefined) => `${fmt(Number(l.qty), 2)} ${l.unit || ""} ${l.place === "rig" ? `on ${rig ?? "the rig"}` : "in the shop"}`.replace(/\s+/g, " ");

/** The AMBIT item a non-foam product is stocked under. */
const stockKey = (p: FieldProduct) => (p.sku || p.skus[0] || `OPS:${p.id}`).trim().toUpperCase();

/** Sets (foam) or bags used, with the lots. Comes off the rig's stock when it's saved. */
export function MaterialTab({ trip, day }: { trip: FieldTrip; day: string }) {
  const { bundle, queue, editable } = useField();
  const can = editable(trip);
  const [editing, setEditing] = useState<Mat | "new" | null>(null);
  const planned = trip.work.filter((w) => w.units && w.unit && w.kind !== "labor");
  const used = trip.materials.filter((m) => !m.date || m.date === day);
  const totals = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; qty: number }>();
    for (const x of trip.materials) {
      const k = x.product ?? x.name;
      const cur = m.get(k) ?? { name: x.name, unit: x.unit, qty: 0 };
      cur.qty += Number(x.qty) || 0;
      m.set(k, cur);
    }
    return [...m.values()];
  }, [trip.materials]);

  return (
    <div className="col" style={{ gap: 12 }}>
      {planned.length ? (
        <section className="card col" style={{ gap: 6 }}>
          <b className="small">Planned for this trip</b>
          {planned.map((w) => {
            const got = trip.materials.filter((m) => m.product && m.product === w.product_id).reduce((s, m) => s + (Number(m.qty) || 0), 0);
            return (
              <div key={w.id} className="row between small" style={{ gap: 8 }}>
                <span className="ellipsis">{w.area ? <b>{w.area} </b> : null}{w.name}</span>
                <span className="faint" style={{ flex: "none" }}>{fmt(Number(w.units), 2)} {w.unit}{got ? ` · used ${fmt(got, 2)}` : ""}</span>
              </div>
            );
          })}
        </section>
      ) : null}

      <div className="row between">
        <b className="small muted">Used this day</b>
        {can && editing === null ? <button type="button" className="btn sm" onClick={() => setEditing("new")}><Plus size={15} /> Add what you used</button> : null}
      </div>

      {editing ? (
        <MatForm
          trip={trip}
          day={day}
          mat={editing === "new" ? null : editing}
          products={bundle.products}
          measureUnit={bundle.settings.measure_unit}
          onDone={(op) => {
            if (op) queue(op);
            setEditing(null);
          }}
        />
      ) : null}

      {!used.length && !editing ? <span className="small muted">Nothing logged for this day yet.</span> : null}
      {used.map((m) => (
        <div key={m.id} className="card fld-mat">
          <span className="col tight grow" style={{ minWidth: 0 }}>
            <b className="ellipsis">{fmt(Number(m.qty), 2)} {m.unit === "set" ? (Number(m.qty) === 1 ? "set" : "sets") : m.unit} · {m.name}</b>
            {isFoam(m.kind) ? (
              <span className="tiny faint">A: {[m.a_maker, m.a_lot].filter(Boolean).join(" ") || "no lot"} · B: {m.b_lot || "no lot"}{m.serials ? ` · drums ${m.serials}` : ""}</span>
            ) : m.lot ? <span className="tiny faint">Lot {m.lot}</span> : null}
            <span className="tiny faint">{m.taken === undefined ? "Saved on this phone" : m.taken.length ? `Taken off ${m.taken.map((t) => (t.place === "rig" ? trip.rig?.name ?? "the rig" : "the shop")).filter((v, i, a) => a.indexOf(v) === i).join(" and ")}` : "Not taken off stock (that lot isn't in the app's stock)"}</span>
          </span>
          {can ? (
            <span className="row" style={{ gap: 4 }}>
              <button type="button" className="iconbtn" aria-label="Change" onClick={() => setEditing(m)}><Pencil size={16} /></button>
              <button type="button" className="iconbtn" aria-label="Delete" onClick={() => { if (confirm("Delete this line? Its stock goes back.")) queue({ t: "mat", trip: trip.id, at: nowIso(), id: m.id, date: m.date, product: m.product, qty: m.qty, deleted: true }); }}><Trash2 size={16} /></button>
            </span>
          ) : null}
        </div>
      ))}

      {totals.length ? (
        <section className="col" style={{ gap: 4 }}>
          <b className="small muted">Whole trip</b>
          {totals.map((t) => <span key={t.name} className="small">{fmt(t.qty, 2)} {t.unit === "set" ? "sets" : t.unit} · {t.name}</span>)}
        </section>
      ) : null}
    </div>
  );
}

function MatForm({ trip, day, mat, products, measureUnit, onDone }: { trip: FieldTrip; day: string; mat: Mat | null; products: FieldProduct[]; measureUnit: string; onDone: (op: MatOp | null) => void }) {
  const onTrip = new Set(trip.work.map((w) => w.product_id).filter(Boolean) as string[]);
  const list = [...products].sort((a, b) => Number(onTrip.has(b.id)) - Number(onTrip.has(a.id)));
  const [product, setProduct] = useState<string>(mat?.product ?? list.find((p) => onTrip.has(p.id))?.id ?? list[0]?.id ?? "");
  const p = products.find((x) => x.id === product) ?? null;
  const foam = isFoam(p?.kind);
  const m = mat?.measure ?? {};
  const [qty, setQty] = useState(mat ? String(mat.qty) : "");
  const [a, setA] = useState(m.a != null ? String(m.a) : "");
  const [b, setB] = useState(m.b != null ? String(m.b) : "");
  const [cs, setCs] = useState(m.start != null ? String(m.start) : "");
  const [ce, setCe] = useState(m.end != null ? String(m.end) : "");
  const isoLots = trip.stock.filter((l) => l.item_key === "ISO");
  const resinLots = trip.stock.filter((l) => p && p.skus[1] && family(l.item_key) === family(p.skus[1]));
  const itemLots = trip.stock.filter((l) => p && !foam && l.item_key === stockKey(p));
  const findA = isoLots.find((l) => l.maker === (mat?.a_maker ?? "") && l.lot_no === (mat?.a_lot ?? ""));
  const findB = resinLots.find((l) => l.lot_no === (mat?.b_lot ?? "") && (!mat?.b_key || l.item_key === mat.b_key));
  const [aPick, setAPick] = useState(mat ? (findA ? lotKey(findA) : mat.a_lot ? "__type" : "") : isoLots[0] ? lotKey(isoLots[0]) : "__type");
  const [aMaker, setAMaker] = useState(mat?.a_maker ?? "Covestro");
  const [aLot, setALot] = useState(mat?.a_lot ?? "");
  const [bPick, setBPick] = useState(mat ? (findB ? lotKey(findB) : mat.b_lot ? "__type" : "") : resinLots[0] ? lotKey(resinLots[0]) : "__type");
  const [bLot, setBLot] = useState(mat?.b_lot ?? "");
  const [lotPick, setLotPick] = useState(mat?.lot ? (itemLots.find((l) => l.lot_no === mat.lot) ? `${stockKey(p!)}||${mat.lot}` : "__type") : "");
  const [lot, setLot] = useState(mat?.lot ?? "");
  const [serials, setSerials] = useState(mat?.serials ?? "");
  const [err, setErr] = useState<string | null>(null);

  const auto = foam && measureUnit === "lbs" ? setsFromLbs(a, b, p?.lb_per_set) : null;
  const shownQty = qty !== "" ? qty : auto !== null ? String(auto) : "";

  const save = () => {
    setErr(null);
    if (!p) return setErr("Pick what you used.");
    const n = Number(shownQty);
    if (!Number.isFinite(n) || n <= 0) return setErr(foam ? "Type the sets used (for example 2.5)." : "Type how many.");
    const op: MatOp = { t: "mat", trip: trip.id, at: nowIso(), id: mat?.id ?? uuid(), date: day, product: p.id, kind: p.kind, name: p.name, unit: foam ? "set" : p.unit, qty: Math.round(n * 100) / 100 };
    if (foam) {
      const A = isoLots.find((l) => lotKey(l) === aPick);
      const B = resinLots.find((l) => lotKey(l) === bPick);
      op.a_maker = A ? A.maker : aPick === "__type" ? aMaker : null;
      op.a_lot = A ? A.lot_no : aPick === "__type" ? aLot.trim() || null : null;
      op.b_key = B ? B.item_key : (p.skus[1] ?? null);
      op.b_lot = B ? B.lot_no : bPick === "__type" ? bLot.trim() || null : null;
      op.serials = serials.trim() || null;
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      op.measure = measureUnit === "strokes" ? { unit: "strokes", start: num(cs), end: num(ce) } : { unit: measureUnit, a: num(a), b: num(b) };
    } else {
      const L = itemLots.find((l) => `${l.item_key}||${l.lot_no}` === lotPick);
      op.lot = L ? L.lot_no : lotPick === "__type" ? lot.trim() || null : null;
    }
    onDone(op);
  };

  return (
    <section className="card col fld-form" style={{ gap: 10 }}>
      <label className="field">
        <span className="fld-l">What</span>
        <select className="input" value={product} onChange={(e) => { setProduct(e.target.value); setQty(""); }}>
          {list.map((x) => <option key={x.id} value={x.id}>{x.name}{onTrip.has(x.id) ? " (on this job)" : ""}</option>)}
        </select>
      </label>

      {foam ? (
        <>
          {measureUnit === "strokes" ? (
            <div className="grid2">
              <label className="field"><span className="fld-l">Stroke counter start</span><input className="input" inputMode="decimal" value={cs} onChange={(e) => setCs(e.target.value)} /></label>
              <label className="field"><span className="fld-l">Stroke counter end</span><input className="input" inputMode="decimal" value={ce} onChange={(e) => setCe(e.target.value)} /></label>
            </div>
          ) : (
            <div className="grid2">
              <label className="field"><span className="fld-l">A-side used <i>{measureUnit === "gallons" ? "gal" : "lb"}</i></span><input className="input" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} /></label>
              <label className="field"><span className="fld-l">B-side used <i>{measureUnit === "gallons" ? "gal" : "lb"}</i></span><input className="input" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} /></label>
            </div>
          )}
          <label className="field">
            <span className="fld-l">Sets used</span>
            <input className="input" inputMode="decimal" value={shownQty} onChange={(e) => setQty(e.target.value)} placeholder="2.5" />
            <span className="tiny faint">{auto !== null && qty === "" ? `Worked out from the pounds (${fmt(p?.lb_per_set ?? null)} lb a set). Type over it if it's off.` : "One set = one A drum + one B drum. Halves and quarters are fine."}</span>
          </label>

          <label className="field">
            <span className="fld-l">A-side (ISO) lot</span>
            <select className="input" value={aPick} onChange={(e) => setAPick(e.target.value)}>
              {isoLots.map((l) => <option key={lotKey(l)} value={lotKey(l)}>{l.maker || "ISO"} · {l.lot_no || "no lot #"} · {where(l, trip.rig?.name)}</option>)}
              <option value="__type">Type the lot…</option>
              <option value="">Don&apos;t know</option>
            </select>
          </label>
          {aPick === "__type" ? (
            <div className="grid2">
              <label className="field"><span className="fld-l">Maker</span><select className="input" value={aMaker} onChange={(e) => setAMaker(e.target.value)}>{MAKERS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field"><span className="fld-l">Lot #</span><input className="input" value={aLot} onChange={(e) => setALot(e.target.value)} placeholder="PA86002841" autoCapitalize="characters" /></label>
            </div>
          ) : null}

          <label className="field">
            <span className="fld-l">B-side (resin) lot</span>
            <select className="input" value={bPick} onChange={(e) => setBPick(e.target.value)}>
              {resinLots.map((l) => <option key={lotKey(l)} value={lotKey(l)}>{l.lot_no || "no lot #"}{/-W$/.test(l.item_key) ? " (Winter)" : ""} · {where(l, trip.rig?.name)}</option>)}
              <option value="__type">Type the lot…</option>
              <option value="">Don&apos;t know</option>
            </select>
          </label>
          {bPick === "__type" ? (
            <label className="field"><span className="fld-l">B-side lot #</span><input className="input" value={bLot} onChange={(e) => setBLot(e.target.value)} placeholder="L7989" autoCapitalize="characters" /></label>
          ) : null}
          <label className="field"><span className="fld-l">Drum serial #s <i>optional</i></span><input className="input" value={serials} onChange={(e) => setSerials(e.target.value)} /></label>
        </>
      ) : (
        <>
          <label className="field">
            <span className="fld-l">How many <i>{p?.unit ?? ""}</i></span>
            <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="field">
            <span className="fld-l">Lot <i>optional</i></span>
            <select className="input" value={lotPick} onChange={(e) => setLotPick(e.target.value)}>
              <option value="">No lot</option>
              {itemLots.map((l) => <option key={`${l.item_key}||${l.lot_no}`} value={`${l.item_key}||${l.lot_no}`}>{l.lot_no || "no lot #"} · {where(l, trip.rig?.name)}</option>)}
              <option value="__type">Type the lot…</option>
            </select>
          </label>
          {lotPick === "__type" ? <label className="field"><span className="fld-l">Lot #</span><input className="input" value={lot} onChange={(e) => setLot(e.target.value)} /></label> : null}
        </>
      )}

      {err ? <div className="alert err small" role="alert"><span>{err}</span></div> : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn grow" onClick={save}>{mat ? "Save" : "Add"}</button>
        <button type="button" className="btn dark" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </section>
  );
}
