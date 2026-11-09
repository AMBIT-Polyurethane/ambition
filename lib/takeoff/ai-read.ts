// What the takeoff AI returns for one plan sheet (shapes in pixels of the picture it was shown), the
// cross-sheet check, and how a reading is cleaned up. Client-safe: the workspace draws from these.

import { ASSEMBLY_KEYS, assemblyOf, type AssemblyKey } from "@/lib/takeoff/assemblies";

export const SHEET_KINDS = ["floor_plan", "foundation", "elevation", "section", "roof", "schedule", "site", "other"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];
export const SHEET_KIND_LABEL: Record<SheetKind, string> = {
  floor_plan: "Floor plan",
  foundation: "Foundation plan",
  elevation: "Elevation",
  section: "Section / details",
  roof: "Roof plan",
  schedule: "Schedule / notes",
  site: "Site plan",
  other: "Other",
};

export const SIDES = ["front", "rear", "left", "right", "interior", "unknown"] as const;
export type Side = (typeof SIDES)[number];
export const COMPONENT_KINDS = ["window", "door", "garage_door", "opening"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export const FACT_TOPICS = ["plate_height", "ceiling_height", "pitch", "attic_type", "foundation", "framing", "rim_joist", "insulation", "builder", "other"] as const;
export type FactTopic = (typeof FACT_TOPICS)[number];
/** The walls a window or door can sit in. */
export const WALL_KEYS = ["exterior_walls", "garage_partition_walls", "knee_walls", "foundation_walls", "other"] as const;

export type XY = [number, number];

export type ReadShape = {
  assembly: AssemblyKey;
  instance: string;
  shape: "polygon" | "line";
  points: XY[];
  /** Wall height (lines) in feet; null when it doesn't apply. */
  height_ft: number | null;
  /** Rise per 12 for sloped areas; null for flat. */
  pitch: number | null;
  source: "plan" | "default" | "none";
  note: string;
};

export type ReadComponent = {
  kind: ComponentKind;
  code: string;
  width_ft: number | null;
  height_ft: number | null;
  side: Side;
  /** Pixel position on the picture (0, 0 when it isn't drawn, e.g. a schedule). */
  x: number;
  y: number;
  wall: (typeof WALL_KEYS)[number];
  note: string;
};

export type ReadFact = { topic: FactTopic; value: string; where: string; quote: string };

export type SheetRead = {
  analysis: string;
  sheet_kind: SheetKind;
  sheet_number: string;
  level: string;
  elevation_side: "front" | "rear" | "left" | "right" | "none";
  scale: { text: string; feet_per_inch: number | null };
  dimension_check: { x1: number; y1: number; x2: number; y2: number; feet: number; quote: string } | null;
  assemblies: ReadShape[];
  components: ReadComponent[];
  facts: ReadFact[];
  notes: string[];
};

export type RuleUsed = { id: string; text: string | null; builder: string | null; mine: boolean };

/** Saved on the sheet: the reading plus the picture's size (so a correction re-reads the same picture). */
export type SheetAi = {
  v: 1;
  at: string;
  model: string;
  /** The picture the AI saw: exact pixel size, and pixels per PDF point. */
  w: number;
  h: number;
  px_per_pt: number;
  read: SheetRead;
  rules: RuleUsed[];
  cost_cents: number;
  /** The last correction typed for this sheet, if this reading came from one. */
  correction?: string | null;
};

export type Discrepancy = { key: string; title: string; detail: string; severity: "high" | "medium" | "low"; sheets: string[] };
export type Reconciled = {
  facts: { topic: FactTopic; value: string; sheets: string[] }[];
  heights: { what: string; height_ft: number; sheets: string[] }[];
  pitches: { where: string; rise: number; sheets: string[] }[];
  components: { kind: ComponentKind; code: string; width_ft: number | null; height_ft: number | null; qty: number; side: Side; sheets: string[] }[];
  discrepancies: Discrepancy[];
  builder: string | null;
  summary: string;
};
/** Saved on the takeoff. */
export type TakeoffAi = { at: string; model: string; reconcile: Reconciled; checked: string[]; cost_cents: number; rules: number };

// ------------------------------------------------------------------ cleaning what came back
const str = (v: unknown, n = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const numIn = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1000) / 1000 : null;
};
const pick = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);

function cleanPoints(v: unknown, w: number, h: number): XY[] {
  if (!Array.isArray(v)) return [];
  const out: XY[] = [];
  for (const p of v) {
    const x = Array.isArray(p) ? Number(p[0]) : Number((p as { x?: unknown })?.x);
    const y = Array.isArray(p) ? Number(p[1]) : Number((p as { y?: unknown })?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // A little outside the picture is a rounding slip; far outside is nonsense.
    if (x < -w * 0.02 || y < -h * 0.02 || x > w * 1.02 || y > h * 1.02) continue;
    const q: XY = [Math.min(w, Math.max(0, Math.round(x * 10) / 10)), Math.min(h, Math.max(0, Math.round(y * 10) / 10))];
    const last = out[out.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    out.push(q);
  }
  return out;
}

/** One sheet's reading, checked: known assemblies only, points inside the picture, numbers in range. */
export function cleanRead(raw: unknown, w: number, h: number): SheetRead {
  const r = (raw ?? {}) as Record<string, unknown>;
  const shapes: ReadShape[] = [];
  for (const a of Array.isArray(r.assemblies) ? r.assemblies.slice(0, 400) : []) {
    const x = (a ?? {}) as Record<string, unknown>;
    const key = String(x.assembly ?? "") as AssemblyKey;
    const def = assemblyOf(key);
    if (!def) continue;
    let pts = cleanPoints(x.points, w, h);
    const line = def.measure === "line";
    // A polygon that repeats its first corner at the end: drop the repeat.
    if (!line && pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
    if (line ? pts.length < 2 : pts.length < 3) continue;
    const hgt = numIn(x.height_ft, 0.25, 60);
    const pitch = numIn(x.pitch, 0.5, 30);
    shapes.push({
      assembly: key,
      instance: str(x.instance, 80),
      shape: line ? "line" : "polygon",
      points: pts,
      height_ft: line ? hgt : null,
      pitch: def.measure === "sloped" ? pitch : null,
      source: pick(x.height_source ?? x.source, ["plan", "default", "none"] as const, "none"),
      note: str(x.note, 240),
    });
  }
  const comps: ReadComponent[] = [];
  for (const c of Array.isArray(r.components) ? r.components.slice(0, 300) : []) {
    const x = (c ?? {}) as Record<string, unknown>;
    const px = numIn(x.x, 0, w) ?? 0;
    const py = numIn(x.y, 0, h) ?? 0;
    comps.push({
      kind: pick(x.kind, COMPONENT_KINDS, "window"),
      code: str(x.code, 30),
      width_ft: numIn(x.width_ft, 0.5, 40),
      height_ft: numIn(x.height_ft, 0.5, 30),
      side: pick(x.side, SIDES, "unknown"),
      x: Math.round(px * 10) / 10,
      y: Math.round(py * 10) / 10,
      wall: pick(x.wall, WALL_KEYS, "exterior_walls"),
      note: str(x.note, 160),
    });
  }
  const dc = (r.dimension_check ?? null) as Record<string, unknown> | null;
  const dcFeet = numIn(dc?.feet, 1, 2000);
  const dcPts = dc ? cleanPoints([[dc.x1, dc.y1], [dc.x2, dc.y2]], w, h) : [];
  const fpi = numIn((r.scale as { feet_per_inch?: unknown } | undefined)?.feet_per_inch, 0.05, 2000);
  return {
    analysis: str(r.analysis, 6000),
    sheet_kind: pick(r.sheet_kind, SHEET_KINDS, "other"),
    sheet_number: str(r.sheet_number, 20),
    level: str(r.level, 40),
    elevation_side: pick(r.elevation_side, ["front", "rear", "left", "right", "none"] as const, "none"),
    scale: { text: str((r.scale as { text?: unknown } | undefined)?.text, 40), feet_per_inch: fpi },
    dimension_check: dc && dc.found !== false && dcFeet && dcPts.length === 2 ? { x1: dcPts[0][0], y1: dcPts[0][1], x2: dcPts[1][0], y2: dcPts[1][1], feet: dcFeet, quote: str(dc.quote, 60) } : null,
    assemblies: shapes,
    components: comps,
    facts: (Array.isArray(r.facts) ? r.facts.slice(0, 60) : []).map((f) => {
      const x = (f ?? {}) as Record<string, unknown>;
      return { topic: pick(x.topic, FACT_TOPICS, "other"), value: str(x.value, 160), where: str(x.where, 80), quote: str(x.quote, 160) };
    }).filter((f) => f.value),
    notes: (Array.isArray(r.notes) ? r.notes.slice(0, 20) : []).map((n) => str(n, 300)).filter(Boolean),
  };
}

/** The reading without its analysis (sent back with a correction, and kept short for the cross-sheet check). */
export function readForCorrection(r: SheetRead) {
  const { analysis: _skip, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

const shoelace = (p: XY[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};
const length = (p: XY[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

/**
 * A compact summary of one sheet's reading for the cross-sheet check: no geometry, just what was found and
 * its size in feet when the scale is known (pxPerFt = pixels per foot on the picture the AI saw).
 */
export function readSummary(name: string, r: SheetRead, pxPerFt: number | null) {
  const size = (s: ReadShape) => {
    if (!pxPerFt) return null;
    return s.shape === "line" ? `${Math.round((length(s.points) / pxPerFt) * 10) / 10} ft` : `${Math.round(shoelace(s.points) / (pxPerFt * pxPerFt))} sq ft flat`;
  };
  return {
    sheet: name,
    kind: r.sheet_kind,
    level: r.level || null,
    elevation_side: r.elevation_side === "none" ? null : r.elevation_side,
    scale: r.scale.text || null,
    shapes: r.assemblies.map((s) => [s.assembly, s.instance || null, size(s), s.height_ft ? `${s.height_ft} ft high` : null, s.pitch ? `${s.pitch}/12` : null, s.source === "default" ? "default used" : null].filter(Boolean).join(" · ")),
    windows_doors: r.components.map((c) => [c.kind, c.code || null, c.side !== "unknown" ? c.side : null, c.width_ft && c.height_ft ? `${c.width_ft}x${c.height_ft} ft` : null].filter(Boolean).join(" ")),
    facts: r.facts.map((f) => `${f.topic}: ${f.value}${f.where ? ` (${f.where})` : ""}`),
    notes: r.notes,
  };
}

/** A four-digit window or door code (3050 = 3'0" x 5'0") as width and height in feet. */
export function codeSize(code: string): { w: number; h: number } | null {
  const x = /(\d+)\s*'\s*-?\s*(\d+)?\s*"?\s*[xX×]\s*(\d+)\s*'\s*-?\s*(\d+)?/.exec(code);
  const d = code.replace(/\D/g, "");
  if (!x && d.length === 4) return { w: Number(d[0]) + Number(d[1]) / 12, h: Number(d[2]) + Number(d[3]) / 12 };
  if (x) return { w: Number(x[1]) + Number(x[2] ?? 0) / 12, h: Number(x[3]) + Number(x[4] ?? 0) / 12 };
  return null;
}

/** Window and door area in square feet (from its size, or its code). */
export function componentSqft(c: { code: string | null; width_ft: number | null; height_ft: number | null; qty?: number }): number {
  const s = c.width_ft && c.height_ft ? { w: c.width_ft, h: c.height_ft } : c.code ? codeSize(c.code) : null;
  return s ? s.w * s.h * (c.qty ?? 1) : 0;
}

export const ASSEMBLY_ENUM = ASSEMBLY_KEYS;
