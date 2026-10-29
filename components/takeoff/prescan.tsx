"use client";

import { useMemo, useState } from "react";
import { Check, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { prescanSheet, saveScan } from "@/app/(app)/takeoff/prescan-actions";
import { mergeScans, type ScanResult, type SheetScan } from "@/lib/takeoff/prescan";
import { defaultAnswers, proposeItems, type Answers, type Proposed } from "@/lib/takeoff/prescan-plan";
import { MATERIALS, type TItem, type TSheet } from "@/lib/takeoff/calc";

type Snap = (s: TSheet) => Promise<{ images: string[]; text: string }>;

const KIND_LABEL: Record<string, string> = { floor_plan: "Floor plan", roof_plan: "Roof plan", elevation: "Elevation", section: "Section", details: "Details", notes: "Notes", site: "Site", other: "Other" };
const matLabel = (m: string | null | undefined) => MATERIALS.find((x) => x.id === m)?.label ?? (m === "unspecified" ? "Not specified" : m ?? "");

/** "AI pre-scan": Claude reads the sheets, then a few questions, then ready-to-measure items. */
export function PrescanDialog({
  takeoffId,
  sheets,
  saved,
  snap,
  onCreate,
  onClose,
}: {
  takeoffId: string;
  sheets: TSheet[];
  saved: ScanResult | null;
  snap: Snap;
  onCreate: (items: Proposed["item"][]) => Promise<void>;
  onClose: () => void;
}) {
  const [scan, setScan] = useState<ScanResult | null>(saved);
  // Architectural sheets first (A, then anything without a letter), up to 12.
  const ranked = useMemo(() => [...sheets].sort((a, b) => rank(a) - rank(b) || a.sort - b.sort), [sheets]);
  const [pick, setPick] = useState<string[]>(() => ranked.slice(0, 12).map((s) => s.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const merged = useMemo(() => (scan ? mergeScans(scan.sheets.map((x) => x.scan)) : null), [scan]);
  const [answers, setAnswers] = useState<Answers | null>(() => (saved ? defaultAnswers(mergeScans(saved.sheets.map((x) => x.scan))) : null));
  const proposed = useMemo(() => (merged && answers ? proposeItems(merged, answers) : []), [merged, answers]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const run = async () => {
    const list = ranked.filter((s) => pick.includes(s.id));
    if (!list.length) return;
    setErrors([]);
    const got: ScanResult["sheets"] = [];
    let cost = 0;
    const errs: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      setBusy(`Reading ${s.name || `page ${s.page}`} (${i + 1} of ${list.length})…`);
      try {
        const input = await snap(s);
        const r = await prescanSheet(takeoffId, { sheet_id: s.id, name: s.name, images: input.images, text: input.text });
        if (r.ok && r.scan) {
          got.push({ sheet_id: s.id, name: s.name, scan: r.scan });
          cost += r.cost ?? 0;
        } else {
          errs.push(`${s.name || `Page ${s.page}`}: ${r.error ?? "didn't read"}`);
          if (/isn't set up|out of credit|isn't working/i.test(r.error ?? "")) break;
        }
      } catch (e) {
        errs.push(`${s.name || `Page ${s.page}`}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(null);
    setErrors(errs);
    if (!got.length) return;
    const result: ScanResult = { sheets: got, at: new Date().toISOString(), cost_cents: Math.round(cost * 100) / 100 };
    setScan(result);
    setAnswers(defaultAnswers(mergeScans(got.map((x) => x.scan))));
    setOff(new Set(proposeItems(mergeScans(got.map((x) => x.scan)), defaultAnswers(mergeScans(got.map((x) => x.scan)))).filter((p) => !p.on).map((p) => p.key)));
    void saveScan(takeoffId, result);
  };

  const create = async () => {
    const items = proposed.filter((p) => !off.has(p.key)).map((p) => ({ ...p.item, name: (names[p.key] ?? p.item.name).trim() || p.item.name }));
    if (!items.length) return;
    setCreating(true);
    await onCreate(items);
    setCreating(false);
    onClose();
  };

  const set = (patch: Partial<Answers>) => setAnswers((a) => (a ? { ...a, ...patch } : a));
  const chosen = proposed.filter((p) => !off.has(p.key)).length;

  return (
    <div className="to-modal" role="dialog" aria-modal="true" aria-label="AI pre-scan" onClick={busy ? undefined : onClose}>
      <div className="to-modal-panel ps-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <b style={{ fontSize: 17 }}><Sparkles size={17} style={{ verticalAlign: -3, color: "var(--red)" }} /> AI pre-scan</b>
          {!busy ? <button type="button" className="to-x" onClick={onClose} aria-label="Close"><X size={16} /></button> : null}
        </div>

        {!scan || busy ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              AI reads each sheet for the insulation called out, roof pitches, wall heights, the garage, porches and the attic, then sets up the items to measure. You still trace the shapes, and check what it found.
            </p>
            {busy ? (
              <div className="ps-busy"><LoaderCircle size={18} className="spin" /> {busy}</div>
            ) : (
              <>
                <div className="row between">
                  <span className="label">Sheets to read ({pick.length})</span>
                  <span className="row" style={{ gap: 10 }}>
                    <button type="button" className="linkbtn small" onClick={() => setPick(ranked.slice(0, 20).map((s) => s.id))}>All (up to 20)</button>
                    <button type="button" className="linkbtn small" onClick={() => setPick([])}>None</button>
                  </span>
                </div>
                <div className="ps-sheets">
                  {ranked.map((s) => {
                    const on = pick.includes(s.id);
                    return (
                      <label key={s.id} className={`ps-sheet${on ? " on" : ""}`}>
                        <input type="checkbox" checked={on} onChange={() => setPick((p) => (on ? p.filter((x) => x !== s.id) : p.length >= 20 ? p : [...p, s.id]))} />
                        <span className="ellipsis">{s.name || `Page ${s.page}`}</span>
                      </label>
                    );
                  })}
                </div>
                <span className="tiny faint">Floor plans, sections, wall sections and the energy or general notes help most. About 20 seconds a sheet.</span>
                <button type="button" className="btn sm" disabled={!pick.length} onClick={() => void run()}><Sparkles size={15} /> Read {pick.length} sheet{pick.length === 1 ? "" : "s"}</button>
              </>
            )}
            {errors.length ? <div className="alert warn small"><span>{errors.join(" · ")}</span></div> : null}
          </>
        ) : merged && answers ? (
          <>
            <div className="ps-found">
              <div className="eyebrow">What the plans say</div>
              {merged.insulation.length ? (
                <ul className="ps-list">
                  {merged.insulation.map((i, n) => (
                    <li key={n}>
                      <b>{i.location}</b> · {matLabel(i.material)}{i.r_value ? ` · R-${i.r_value}` : ""}{i.thickness_in ? ` · ${i.thickness_in}"` : ""}
                      {i.quote ? <span className="tiny faint"> &ldquo;{i.quote}&rdquo;</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="small muted">No insulation called out on these sheets.</span>
              )}
              <div className="ps-facts">
                <span>Roof pitch: <b>{merged.pitches.length ? merged.pitches.map((p) => `${p.rise}/12`).join(", ") : "not shown"}</b></span>
                <span>Wall heights: <b>{merged.heights.length ? merged.heights.map((h) => `${h.feet}'${h.where.length ? ` (${h.where.join(", ")})` : ""}`).join(", ") : "not shown"}</b></span>
                <span>Exterior walls: <b>{merged.framing === "unknown" ? "framing not shown" : merged.framing}</b></span>
                <span>Garage: <b>{merged.garage}{merged.living_over_garage ? ", living space over it" : ""}</b> · Porch: <b>{merged.porch === null ? "not shown" : merged.porch ? "yes" : "no"}</b></span>
                <span>Attic: <b>{merged.attic === "sealed" ? "sealed (foam at the roof)" : merged.attic === "vented" ? "vented" : merged.attic === "both" ? "part sealed, part vented" : "not shown"}</b>{merged.climate_zone ? ` · Climate zone ${merged.climate_zone}` : ""}</span>
              </div>
              {merged.notes.length ? <ul className="ps-list tiny">{merged.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
              <span className="tiny faint">
                Read {scan.sheets.length} sheet{scan.sheets.length === 1 ? "" : "s"} ({scan.sheets.map((x) => `${x.name ?? "sheet"}: ${KIND_LABEL[x.scan.sheet_kind] ?? ""}`).join(", ")}).{" "}
                <button type="button" className="linkbtn tiny" onClick={() => setScan(null)}><RotateCcw size={11} /> Read again</button>
              </span>
            </div>

            <div className="ps-q">
              <div className="eyebrow">A few questions</div>
              {merged.garage === "attached" ? (
                <Q label="Is the garage part of the conditioned house?" value={answers.garageInside === null ? null : answers.garageInside ? "yes" : "no"} options={[["no", "No, it's not heated or cooled"], ["yes", "Yes"]]} onChange={(v) => set({ garageInside: v === "yes" })} />
              ) : null}
              <Q label="The attic over the house" value={answers.sealedAttic ? "sealed" : "vented"} options={[["sealed", "Sealed: foam at the roof deck"], ["vented", "Vented: insulate the attic floor"]]} onChange={(v) => set({ sealedAttic: v === "sealed" })} />
              {answers.sealedAttic && (merged.garage === "attached" || merged.porch) ? (
                <Q label="Are the porch and garage attics walled off (kept vented)?" value={answers.demising ? "yes" : "no"} options={[["yes", "Yes: add attic demising walls"], ["no", "No: foam the whole roofline"]]} onChange={(v) => set({ demising: v === "yes" })} />
              ) : null}
              <div className="q-row">
                <label className="field" style={{ maxWidth: 160 }}>
                  <span className="label">Roof pitch</span>
                  <select className="select sm" value={answers.pitch ?? ""} onChange={(e) => set({ pitch: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Not sure</option>
                    {[...new Set([...merged.pitches.map((p) => p.rise), 3, 4, 5, 6, 7, 8, 9, 10, 12])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r}/12{merged.pitches.some((p) => p.rise === r) ? " (plans)" : ""}</option>)}
                  </select>
                </label>
                <label className="field" style={{ maxWidth: 170 }}>
                  <span className="label">Exterior wall framing</span>
                  <select className="select sm" value={answers.framing} onChange={(e) => set({ framing: e.target.value as Answers["framing"] })}>
                    <option value="unknown">Not sure</option>
                    <option value="2x4">2x4</option>
                    <option value="2x6">2x6</option>
                    <option value="2x8">2x8</option>
                  </select>
                </label>
                <label className="field" style={{ flex: "1 1 180px" }}>
                  <span className="label">Wall heights (feet)</span>
                  <input className="input sm" defaultValue={answers.heights.join(", ")} placeholder="9, 10" onChange={(e) => set({ heights: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n >= 2 && n <= 40) })} />
                </label>
              </div>
            </div>

            <div className="ps-items">
              <div className="eyebrow">Items to set up ({chosen})</div>
              {proposed.map((p) => {
                const on = !off.has(p.key);
                return (
                  <div key={p.key} className={`ps-item${on ? " on" : ""}`}>
                    <input type="checkbox" checked={on} aria-label={`Set up ${p.item.name}`} onChange={() => setOff((o) => { const n = new Set(o); if (on) n.add(p.key); else n.delete(p.key); return n; })} />
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <input className="ps-name" value={names[p.key] ?? p.item.name} onChange={(e) => setNames((x) => ({ ...x, [p.key]: e.target.value }))} aria-label="Item name" maxLength={80} />
                      <span className="tiny muted">{describe(p.item)}</span>
                      {p.why ? <span className="tiny faint">{p.why}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn sm" disabled={!chosen || creating} onClick={() => void create()}>
                {creating ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Set up {chosen} item{chosen === 1 ? "" : "s"}
              </button>
              <button type="button" className="btn sm dark" onClick={onClose}>Not now</button>
            </div>
            <span className="tiny faint">Then pick each item and trace it on the plan. Check depths and R-values: AI can misread small print.</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Q({ label, value, options, onChange }: { label: string; value: string | null; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="seg sm" role="radiogroup" aria-label={label}>
        {options.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function describe(it: Proposed["item"]) {
  const bits = [it.area_code, matLabel(it.material), it.thickness_in ? `${it.thickness_in}"` : null, it.r_value, it.kind === "linear" ? (it.shape === "gable" ? `gable wall, ${it.pitch ?? "?"}/12` : it.height_ft ? `walls ${it.height_ft}' high` : "length") : it.kind === "area" ? (it.pitch ? `area at ${it.pitch}/12 pitch` : "area") : "count"];
  return bits.filter(Boolean).join(" · ");
}

function rank(s: TSheet) {
  const n = (s.name ?? "").toUpperCase();
  if (/^A/.test(n)) return 0;
  if (/^(S|E|M|P|C|L)\d/.test(n)) return 3;
  if (/^(G|T|CS|CV)/.test(n)) return 2;
  return 1;
}

export type { SheetScan, TItem };
