"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { TARGETS, coreDensity, fmt, imbalance, readingChecks } from "@/lib/ops/field/calc";
import type { DayLog, FieldTrip, Section } from "@/lib/ops/field/types";
import { Badge, NumField, Pick, TextField, YES_NO, nowIso, useField } from "./bits";

// The Spray Job Data Log (AMBIT form SDL-01), one per spray day: take readings at the start, midday
// and end. Dew point, the margin over it, the A/B imbalance and core density work themselves out.

const WHEN = [
  { k: "start", l: "Start" },
  { k: "mid", l: "Midday" },
  { k: "end", l: "End" },
] as const;

type R = Record<string, unknown>;
const obj = (v: unknown): R => (v && typeof v === "object" ? (v as R) : {});

export function LogTab({ trip, day }: { trip: FieldTrip; day: string }) {
  const { queue, editable } = useField();
  const can = editable(trip);
  const log: DayLog = trip.days_log.find((d) => d.date === day) ?? { date: day, conditions: {}, equipment: {}, material: {}, quality: {}, safety: {} };
  const set = (section: Section, key: string, value: unknown) => queue({ t: "day", trip: trip.id, at: nowIso(), date: day, [section]: { [key]: value } });
  /** A reading inside readings.start / .mid / .end. Only that one value is sent; it merges key by key. */
  const setReading = (section: "conditions" | "equipment", when: string, key: string, value: unknown) => set(section, "readings", { [when]: { [key]: value } });
  const c = log.conditions;
  const e = log.equipment;
  const m = log.material;
  const q = log.quality;
  const s = log.safety;
  const rC = obj(c.readings);
  const rE = obj(e.readings);
  const prep = obj(c.prep);
  const checks = WHEN.map((w) => readingChecks(obj(rC[w.k])));
  const overall = checks.some((x) => x.all === "bad") ? "bad" : checks.some((x) => x.all === "ok") ? "ok" : null;
  const density = coreDensity(q.cup_mass_g, q.cup_ml);

  return (
    <div className="col" style={{ gap: 10 }}>
      {log.updated_by_name ? <span className="tiny faint">Last changed by {log.updated_by_name}</span> : null}

      <Block title="Site and substrate" note={overall === "bad" ? <Badge check="bad">Check conditions</Badge> : overall === "ok" ? <Badge check="ok">Conditions OK</Badge> : null} open>
        <div className="fld-grid">
          <Pick label="Sky" value={c.sky} options={["Clear", "Partly cloudy", "Overcast", "Rain", "Snow", "Indoors"]} onSave={(v) => set("conditions", "sky", v)} disabled={!can} wide />
          <Pick label="Wind" value={c.wind} options={["Calm", "Light", "Moderate", "Strong"]} onSave={(v) => set("conditions", "wind", v)} disabled={!can} wide />
          <TextField label="IR gun / moisture meter used" value={c.meter as string} onSave={(v) => set("conditions", "meter", v)} disabled={!can} wide />
        </div>
        <div className="fld-readings">
          {WHEN.map((w, i) => {
            const r = obj(rC[w.k]);
            const ck = checks[i];
            return (
              <div key={w.k} className="fld-reading">
                <b className="small">{w.l}</b>
                <div className="fld-grid tight">
                  <TextField label="Time" value={r.time as string} onSave={(v) => setReading("conditions", w.k, "time", v)} disabled={!can} placeholder="7:30 AM" />
                  <NumField label="Air temp" unit="°F" value={r.ambient} onSave={(v) => setReading("conditions", w.k, "ambient", v)} disabled={!can} min={-40} max={140} />
                  <NumField label="Humidity" unit="%" value={r.rh} onSave={(v) => setReading("conditions", w.k, "rh", v)} disabled={!can} min={0} max={100} />
                  <NumField label="Substrate temp" unit="°F" value={r.substrate} onSave={(v) => setReading("conditions", w.k, "substrate", v)} disabled={!can} min={-40} max={200} />
                  <NumField label="Wood moisture" unit="%" value={r.wood_mc} onSave={(v) => setReading("conditions", w.k, "wood_mc", v)} disabled={!can} min={0} max={100} />
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <span className="pill grey">Dew point {ck.dew === null ? "–" : `${fmt(ck.dew, 1)}°F`}</span>
                  <Badge check={ck.aboveOk}>Above dew point {ck.above === null ? "–" : `${fmt(ck.above, 1)}°F`} (min {TARGETS.aboveDewF})</Badge>
                  {r.wood_mc !== undefined && r.wood_mc !== null ? <Badge check={ck.mcOk}>Moisture {String(r.wood_mc)}% (max {TARGETS.woodMcMax})</Badge> : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="fld-l">Substrate prep</span>
          <div className="chips wrap fld-chips">
            {[
              ["clean", "Clean"],
              ["dry", "Dry"],
              ["no_frost", "No frost / dew"],
              ["no_oil", "No oil, dust or release agent"],
              ["sound", "Sound and fastened"],
            ].map(([k, l]) => (
              <button key={k} type="button" className={`chip sm${prep[k] ? " on" : ""}`} aria-pressed={!!prep[k]} disabled={!can} onClick={() => set("conditions", "prep", { [k]: !prep[k] })}>
                {prep[k] ? "✓ " : ""}{l}
              </button>
            ))}
          </div>
          <TextField label="Primer used" value={c.primer as string} onSave={(v) => set("conditions", "primer", v)} disabled={!can} placeholder="None" />
        </div>
      </Block>

      <Block title="Equipment and settings" note={WHEN.some((w) => (imbalance(obj(rE[w.k]).a_psi, obj(rE[w.k]).b_psi) ?? 0) > TARGETS.imbalanceMax) ? <Badge check="bad">Pressure imbalance</Badge> : null}>
        <div className="fld-grid">
          <TextField label="Proportioner" value={e.proportioner as string} onSave={(v) => set("equipment", "proportioner", v)} disabled={!can} placeholder="Graco E-30" />
          <TextField label="Spray gun" value={e.gun as string} onSave={(v) => set("equipment", "gun", v)} disabled={!can} placeholder="Fusion AP" />
          <TextField label="Mix chamber" value={e.chamber as string} onSave={(v) => set("equipment", "chamber", v)} disabled={!can} placeholder="AR4242" />
          <NumField label="Hose length" unit="ft" value={e.hose_ft} onSave={(v) => set("equipment", "hose_ft", v)} disabled={!can} min={0} max={1000} />
        </div>
        <div className="fld-readings">
          {WHEN.map((w) => {
            const r = obj(rE[w.k]);
            const imb = imbalance(r.a_psi, r.b_psi);
            return (
              <div key={w.k} className="fld-reading">
                <b className="small">{w.l}</b>
                <div className="fld-grid tight">
                  <NumField label="A (iso) temp" unit="°F" value={r.a_temp} onSave={(v) => setReading("equipment", w.k, "a_temp", v)} disabled={!can} min={0} max={250} />
                  <NumField label="B (resin) temp" unit="°F" value={r.b_temp} onSave={(v) => setReading("equipment", w.k, "b_temp", v)} disabled={!can} min={0} max={250} />
                  <NumField label="Hose temp" unit="°F" value={r.hose_temp} onSave={(v) => setReading("equipment", w.k, "hose_temp", v)} disabled={!can} min={0} max={250} />
                  <NumField label="A pressure" unit="psi" value={r.a_psi} onSave={(v) => setReading("equipment", w.k, "a_psi", v)} disabled={!can} min={0} max={5000} />
                  <NumField label="B pressure" unit="psi" value={r.b_psi} onSave={(v) => setReading("equipment", w.k, "b_psi", v)} disabled={!can} min={0} max={5000} />
                </div>
                {imb !== null ? <Badge check={imb <= TARGETS.imbalanceMax ? "ok" : "bad"}>A/B imbalance {fmt(imb)} psi (max {TARGETS.imbalanceMax})</Badge> : null}
              </div>
            );
          })}
        </div>
        <div className="fld-grid">
          <Pick label="Ratio check" value={e.ratio} options={["OK", "Off", "Not checked"]} onSave={(v) => set("equipment", "ratio", v)} disabled={!can} />
          <Pick label="Rig data log saved?" value={e.rig_log} options={YES_NO} onSave={(v) => set("equipment", "rig_log", v)} disabled={!can} />
          <TextField label="Equipment notes" value={e.notes as string} onSave={(v) => set("equipment", "notes", v)} disabled={!can} multiline wide />
        </div>
      </Block>

      <Block title="Drums and coating">
        <div className="fld-grid">
          <NumField label="Drum storage temp" unit="°F" value={m.storage_temp} onSave={(v) => set("material", "storage_temp", v)} disabled={!can} min={-40} max={160} />
          <NumField label="A drum temp at spray" unit="°F" value={m.a_drum_temp} onSave={(v) => set("material", "a_drum_temp", v)} disabled={!can} min={-40} max={160} />
          <NumField label="B drum temp at spray" unit="°F" value={m.b_drum_temp} onSave={(v) => set("material", "b_drum_temp", v)} disabled={!can} min={-40} max={160} />
          <Pick label="B-side mixed?" value={m.b_mixed} options={YES_NO} onSave={(v) => set("material", "b_mixed", v)} disabled={!can} />
          <TextField label="Coating / barrier applied" value={m.coating as string} onSave={(v) => set("material", "coating", v)} disabled={!can} placeholder="None" />
          <NumField label="Coating thickness" unit="wet mils" value={m.coating_mils} onSave={(v) => set("material", "coating_mils", v)} disabled={!can} min={0} max={200} />
        </div>
      </Block>

      <Block title="Quality checks" note={density !== null ? <span className="pill grey">Core density {fmt(density, 2)} lb/ft³</span> : null}>
        <div className="fld-grid">
          <NumField label="Density cup: foam mass" unit="g" value={q.cup_mass_g} onSave={(v) => set("quality", "cup_mass_g", v)} disabled={!can} min={0} max={5000} />
          <NumField label="Cup volume" unit="mL" value={q.cup_ml} onSave={(v) => set("quality", "cup_ml", v)} disabled={!can} min={0} max={10000} />
          <NumField label="Max single pass" unit="in" value={q.max_pass_in} onSave={(v) => set("quality", "max_pass_in", v)} disabled={!can} min={0} max={24} />
          <Pick label="Adhesion test" value={q.adhesion} options={["Pass", "Fail", "Not tested"]} onSave={(v) => set("quality", "adhesion", v)} disabled={!can} />
          <Pick label="Cell structure and color" value={q.cell} options={["Good", "Off"]} onSave={(v) => set("quality", "cell", v)} disabled={!can} />
          <Pick label="Shrinkage / pull-away" value={q.shrinkage} options={["None", "Some"]} onSave={(v) => set("quality", "shrinkage", v)} disabled={!can} />
          <Pick label="Cracking / fissures" value={q.cracking} options={["None", "Some"]} onSave={(v) => set("quality", "cracking", v)} disabled={!can} />
          <Pick label="Cure and odor" value={q.cure} options={["Normal", "Off"]} onSave={(v) => set("quality", "cure", v)} disabled={!can} />
          <Pick label="Core sample kept?" value={q.core_kept} options={YES_NO} onSave={(v) => set("quality", "core_kept", v)} disabled={!can} />
        </div>
      </Block>

      <Block title="Safety and re-occupancy">
        <div className="fld-grid">
          <TextField label="Ventilation during spray" value={s.ventilation as string} onSave={(v) => set("safety", "ventilation", v)} disabled={!can} placeholder="Exhaust fan, 2,000 CFM" />
          <Pick label="Occupants out during spray?" value={s.occupants_out} options={YES_NO} onSave={(v) => set("safety", "occupants_out", v)} disabled={!can} />
          <NumField label="Re-entry time posted" unit="hrs" value={s.reentry_hrs} onSave={(v) => set("safety", "reentry_hrs", v)} disabled={!can} min={0} max={240} />
          <Pick label="Sprayer respirator" value={s.respirator} options={["Supplied air", "Full-face APR", "Half-face APR"]} onSave={(v) => set("safety", "respirator", v)} disabled={!can} />
          <Pick label="Warning signs posted?" value={s.signage} options={YES_NO} onSave={(v) => set("safety", "signage", v)} disabled={!can} />
          <NumField label="Ventilation after spray" unit="hrs" value={s.vent_after_hrs} onSave={(v) => set("safety", "vent_after_hrs", v)} disabled={!can} min={0} max={240} />
        </div>
      </Block>
      <span className="tiny faint">Targets: substrate at least 5°F above dew point · wood 19% moisture or less · A/B pressure within 200 psi. General SPF practice; the AMBIT product TDS governs.</span>
    </div>
  );
}

function Block({ title, note, open: start = false, children }: { title: string; note?: React.ReactNode; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(start);
  return (
    <section className={`card col fld-block${open ? " open" : ""}`} style={{ gap: 12 }}>
      <button type="button" className="fld-block-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <b className="grow" style={{ textAlign: "left" }}>{title}</b>
        {note}
        <ChevronDown size={18} className="faint fld-chev" />
      </button>
      {open ? children : null}
    </section>
  );
}
