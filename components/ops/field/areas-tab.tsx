"use client";

import { Plus, Trash2 } from "lucide-react";
import { DEFAULT_WORK_AREAS } from "@/lib/ops/defaults";
import { boardFeet, fmt, isFoam, yields } from "@/lib/ops/field/calc";
import type { Area, AreaOp, FieldTrip } from "@/lib/ops/field/types";
import { NumField, Pick, nowIso, useField, uuid } from "./bits";

const SUBSTRATES = ["Wood", "OSB / plywood", "Metal", "Concrete / CMU", "Drywall", "Other"];

/** Application and yield: square feet and average thickness by area; board feet and yield follow. */
export function AreasTab({ trip, day }: { trip: FieldTrip; day: string }) {
  const { bundle, queue, editable } = useField();
  const can = editable(trip);
  const areaList = bundle.settings.work_areas?.length ? bundle.settings.work_areas : DEFAULT_WORK_AREAS;
  const sprayable = bundle.products.filter((p) => isFoam(p.kind) || ["blown", "batt", "coating"].includes(p.kind));
  const rows = trip.areas.filter((a) => !a.date || a.date === day);
  const lines = trip.work.filter((w) => w.sqft && (isFoam(w.kind) || ["blown", "batt", "coating"].includes(w.kind)));
  const all = yields(bundle.products, trip.materials, trip.areas);

  const op = (a: Area, change: Partial<AreaOp> = {}): AreaOp => ({
    t: "area", trip: trip.id, at: nowIso(), id: a.id, date: a.date ?? day, line: a.line, area: a.area, name: a.name, substrate: a.substrate,
    product: a.product, kind: a.kind, sqft: a.sqft, thick: a.thick, passes: a.passes, sort: a.sort, ...change,
  });
  const startFromJob = () =>
    queue(
      lines.map((w, i) => ({
        t: "area" as const, trip: trip.id, at: nowIso(), id: uuid(), date: day, line: w.id, area: w.area, name: w.name, substrate: null,
        product: w.product_id, kind: w.kind, sqft: w.sqft, thick: isFoam(w.kind) ? w.depth_in : null, passes: null, sort: trip.areas.length + i,
      })),
    );
  const addArea = () => {
    const foam = sprayable.find((p) => isFoam(p.kind));
    queue({ t: "area", trip: trip.id, at: nowIso(), id: uuid(), date: day, area: areaList[0]?.code ?? null, name: null, substrate: null, product: foam?.id ?? null, kind: foam?.kind ?? null, sqft: null, thick: null, passes: null, sort: trip.areas.length });
  };

  const totSq = rows.reduce((s, a) => s + (Number(a.sqft) || 0), 0);
  const totBf = rows.filter((a) => isFoam(a.kind)).reduce((s, a) => s + boardFeet(a), 0);

  return (
    <div className="col" style={{ gap: 12 }}>
      {can && !rows.length && lines.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b className="small">Start from the job</b>
          <span className="small muted">{lines.map((l) => `${l.area ?? ""} ${fmt(Number(l.sqft))} sq ft`.trim()).join(" · ")}</span>
          <button type="button" className="btn sm" onClick={startFromJob}>Use the job&apos;s areas</button>
        </section>
      ) : null}

      {rows.map((a) => {
        const foam = isFoam(a.kind);
        return (
          <section key={a.id} className="card col fld-area" style={{ gap: 10 }}>
            <div className="row between" style={{ gap: 8 }}>
              <select className="input sm" style={{ maxWidth: 190 }} value={a.area ?? ""} disabled={!can} aria-label="Area" onChange={(e) => queue(op(a, { area: e.target.value || null }))}>
                <option value="">Area</option>
                {areaList.map((w) => <option key={w.code} value={w.code}>{w.code} · {w.name}</option>)}
              </select>
              <span className="row" style={{ gap: 6 }}>
                {foam ? <span className="pill grey">{fmt(boardFeet(a))} bd ft</span> : null}
                {can ? <button type="button" className="iconbtn" aria-label="Delete area" onClick={() => { if (confirm("Delete this area?")) queue(op(a, { deleted: true })); }}><Trash2 size={16} /></button> : null}
              </span>
            </div>
            {a.name ? <span className="tiny faint">{a.name}</span> : null}
            <select className="input sm" value={a.product ?? ""} disabled={!can} aria-label="Product" onChange={(e) => { const p = sprayable.find((x) => x.id === e.target.value); queue(op(a, { product: p?.id ?? null, kind: p?.kind ?? null })); }}>
              <option value="">Product</option>
              {sprayable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="fld-grid tight">
              <NumField label="Sq ft" value={a.sqft} onSave={(v) => queue(op(a, { sqft: v }))} disabled={!can} min={0} max={1000000} />
              {foam ? <NumField label="Avg thickness" unit="in" value={a.thick} onSave={(v) => queue(op(a, { thick: v }))} disabled={!can} min={0} max={48} /> : null}
              {foam ? <NumField label="Passes" value={a.passes} onSave={(v) => queue(op(a, { passes: v === null ? null : Math.round(v) }))} disabled={!can} min={0} max={30} /> : null}
            </div>
            <Pick label="Substrate" value={a.substrate} options={SUBSTRATES} onSave={(v) => queue(op(a, { substrate: v }))} disabled={!can} wide />
          </section>
        );
      })}

      {can ? <button type="button" className="btn sm dark" onClick={addArea}><Plus size={15} /> Add an area</button> : null}

      {rows.length ? (
        <section className="card col" style={{ gap: 6 }}>
          <div className="row between small"><span>Total sq ft (this day)</span><b>{fmt(totSq)}</b></div>
          <div className="row between small"><span>Total board feet (this day)</span><b>{fmt(totBf)}</b></div>
        </section>
      ) : null}

      {all.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b className="small">Yield on this trip</b>
          {all.map((y) => (
            <div key={y.product.id} className="col tight">
              <span className="small">{y.product.name}</span>
              <span className="tiny faint">
                {fmt(y.bf)} bd ft ÷ {fmt(y.sets, 2)} sets = <b>{y.actual === null ? "–" : `${fmt(y.actual)} bd ft/set`}</b>
                {y.expected ? ` · expected ${fmt(y.expected)}` : ""}
              </span>
              {y.pct !== null ? <span className={`pill ${y.pct >= 90 ? "ok" : y.pct >= 75 ? "warn" : "red"}`} style={{ alignSelf: "flex-start" }}>{y.pct}% of expected yield</span> : <span className="tiny faint">{y.sets ? "Add the areas sprayed to see the yield." : "Log the sets used (Material) to see the yield."}</span>}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
