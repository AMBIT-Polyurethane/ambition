// Turning an AI reading into items and shapes on the takeoff (client-safe, no saving here).
// - Walls, ceilings and floors count from floor plans; slab and foundation walls from the foundation plan
//   (or the lowest floor plan when there's none); roof lines from the roof plan (or a floor plan when
//   no roof plan has them). Everything else the AI traced (elevations, sections) is reference only.
// - AI shapes start "unchecked" (dashed). Reading a sheet again replaces only its unchecked AI shapes:
//   anything a person drew or edited stays, and a new shape that matches one of those is skipped.

import { assemblyOf, type AssemblyKey } from "@/lib/takeoff/assemblies";
import type { ReadShape, SheetAi, SheetKind } from "@/lib/takeoff/ai-read";
import { polygonArea, polylineLength, type Pt, type TItem, type TMark, type TSheet } from "@/lib/takeoff/calc";

export type SheetWithAi = TSheet & { ai?: SheetAi | null };

export type ComponentRow = {
  id: string;
  sheet_id: string | null;
  kind: string;
  code: string | null;
  width_ft: number | null;
  height_ft: number | null;
  qty: number;
  side: string | null;
  wall: string | null;
  label: string | null;
  x: number | null;
  y: number | null;
  ai: boolean;
  note: string | null;
};

export type ApplyPlan = {
  newItems: { item: TItem; marks: TMark[] }[];
  addMarks: TMark[];
  delMarks: TMark[];
  delItems: { item: TItem; marks: TMark[] }[];
  components: ComponentRow[];
  counts: { shapes: number; counted: number; reference: number; skipped: number; windows: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function levelRank(level: string): number {
  const l = level.toLowerCase();
  if (/basement|lower level|cellar/.test(l)) return 0;
  if (/second|2nd|upper|bonus/.test(l)) return 2;
  if (/third|3rd/.test(l)) return 3;
  if (/attic|roof/.test(l)) return 4;
  return 1; // first floor, main, ground, or not said
}

export type CountCtx = { hasFoundation: boolean; roofLines: boolean; lowest: number };

/** What every read sheet tells us about where each quantity is counted. */
export function countContext(sheets: SheetWithAi[]): CountCtx {
  const reads = sheets.map((s) => s.ai?.read).filter(Boolean) as SheetAi["read"][];
  const floors = reads.filter((r) => r.sheet_kind === "floor_plan");
  return {
    hasFoundation: reads.some((r) => r.sheet_kind === "foundation" && r.assemblies.some((a) => a.assembly === "slab" || a.assembly === "foundation_walls")),
    roofLines: reads.some((r) => r.sheet_kind === "roof" && r.assemblies.some((a) => a.assembly === "roof_line" || a.assembly === "garage_roof_line")),
    lowest: floors.length ? Math.min(...floors.map((r) => levelRank(r.level))) : 1,
  };
}

/** Is this shape counted, or for reference only? */
export function counted(kind: SheetKind, level: string, a: AssemblyKey, ctx: CountCtx): boolean {
  if (a === "slab" || a === "foundation_walls") {
    if (kind === "foundation") return true;
    return kind === "floor_plan" && !ctx.hasFoundation && levelRank(level) === ctx.lowest;
  }
  if (a === "roof_line" || a === "garage_roof_line") {
    if (kind === "roof") return true;
    return kind === "floor_plan" && !ctx.roofLines;
  }
  if (kind === "foundation") return a === "rim_joist_ambient";
  return kind === "floor_plan";
}

const feetIn = (ft: number) => {
  const t = Math.round(ft * 12);
  return `${Math.floor(t / 12)}'-${t % 12}"`;
};

/** The value that splits an assembly into separate items: wall height, or pitch for sloped areas. */
function splitValue(s: ReadShape): number | null {
  const def = assemblyOf(s.assembly)!;
  if (def.measure === "line") return r2(s.height_ft ?? def.height ?? 0) || null;
  if (def.measure === "sloped") return r2(s.pitch ?? def.pitch ?? 0) || null;
  return null;
}

function itemName(a: AssemblyKey, v: number | null): string {
  const def = assemblyOf(a)!;
  if (v === null) return def.label;
  return def.measure === "line" ? `${def.label} · ${feetIn(v)}` : `${def.label} · ${r2(v)}/12`;
}

const sameValue = (x: number | null | undefined, y: number | null) => Math.abs(Number(x ?? 0) - Number(y ?? 0)) < 0.01;

function itemMatches(it: TItem, a: AssemblyKey, v: number | null): boolean {
  const def = assemblyOf(a)!;
  const isIt = it.assembly ? it.assembly === a : it.name.trim().toLowerCase().startsWith(def.label.toLowerCase());
  if (!isIt) return false;
  if (def.measure === "line") return it.kind === "linear" && it.shape !== "gable" && sameValue(it.height_ft, v);
  if (def.measure === "sloped") return it.kind === "area" && sameValue(it.pitch, v);
  return it.kind === "area";
}

const centroid = (p: Pt[]): Pt => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

/** A new AI shape that's (nearly) the same as one a person already has on this sheet. */
function duplicateOf(pts: Pt[], line: boolean, kept: TMark[], tol: number): boolean {
  const size = line ? polylineLength(pts) : polygonArea(pts);
  const c = centroid(pts);
  return kept.some((m) => {
    const s2 = line ? polylineLength(m.points) : polygonArea(m.points);
    const c2 = centroid(m.points);
    return Math.hypot(c[0] - c2[0], c[1] - c2[1]) < tol && Math.abs(size - s2) <= Math.max(size, s2) * 0.1;
  });
}

const SIDE_LETTER: Record<string, string> = { front: "F", rear: "B", left: "L", right: "R", interior: "I", unknown: "W" };

/**
 * What applying one sheet's reading changes. `newId` makes ids (crypto.randomUUID in the browser);
 * `colors` picks a color for new items.
 */
export function planApply(opts: {
  sheet: SheetWithAi;
  ai: SheetAi;
  sheets: SheetWithAi[];
  items: TItem[];
  marks: TMark[];
  components: ComponentRow[];
  newId: () => string;
}): ApplyPlan {
  const { sheet, ai } = opts;
  const read = ai.read;
  const ctx = countContext(opts.sheets.map((s) => (s.id === sheet.id ? { ...s, ai } : s)));
  const k = 1 / ai.px_per_pt;
  const toPt = (p: [number, number]): Pt => [r2(p[0] * k), r2(p[1] * k)];

  // This sheet's unchecked AI shapes go; everything a person drew or edited stays.
  const delMarks = opts.marks.filter((m) => m.sheet_id === sheet.id && m.ai);
  const kept = opts.marks.filter((m) => m.sheet_id === sheet.id && !m.ai);
  const tol = Math.hypot(Number(sheet.width_pt ?? 0), Number(sheet.height_pt ?? 0)) * 0.02;

  const items = [...opts.items];
  const newItems: { item: TItem; marks: TMark[] }[] = [];
  const addMarks: TMark[] = [];
  let sort = Math.max(0, ...items.map((i) => i.sort));
  let countedN = 0;
  let refN = 0;
  let skipped = 0;

  for (const s of read.assemblies) {
    const def = assemblyOf(s.assembly);
    if (!def) continue;
    const v = splitValue(s);
    const line = def.measure === "line";
    const pts = s.points.map(toPt);
    const isCounted = counted(read.sheet_kind, read.level, s.assembly, ctx);
    let it = items.find((x) => itemMatches(x, s.assembly, v)) ?? newItems.find((x) => itemMatches(x.item, s.assembly, v))?.item;
    if (it && duplicateOf(pts, line, kept.filter((m) => m.item_id === it!.id), tol)) {
      skipped++;
      continue;
    }
    const mark = (itemId: string): TMark => ({ id: opts.newId(), item_id: itemId, sheet_id: sheet.id, points: pts, cutout: false, ai: true, ref: !isCounted, note: s.instance || null });
    if (isCounted) countedN++;
    else refN++;
    if (it) {
      const fresh = newItems.find((x) => x.item.id === it!.id);
      if (fresh) fresh.marks.push(mark(it.id));
      else addMarks.push(mark(it.id));
      continue;
    }
    it = {
      id: opts.newId(),
      name: itemName(s.assembly, v),
      kind: line ? "linear" : "area",
      color: def.color,
      material: def.material,
      thickness_in: def.thickness_in,
      r_value: null,
      height_ft: line ? v ?? def.height ?? null : null,
      pitch: def.measure === "sloped" ? v ?? def.pitch ?? null : null,
      deduct_sqft: 0,
      hidden: false,
      sort: ++sort,
      area_code: def.area_code,
      shape: null,
      assembly: s.assembly,
      ai: true,
    };
    newItems.push({ item: it, marks: [mark(it.id)] });
  }

  // AI items left with no shapes at all (everything they had was replaced) go too.
  const gone = new Set(delMarks.map((m) => m.id));
  const still = new Set([...opts.marks.filter((m) => !gone.has(m.id)).map((m) => m.item_id), ...addMarks.map((m) => m.item_id)]);
  const delItems = opts.items.filter((it) => it.ai && !still.has(it.id)).map((item) => ({ item, marks: [] as TMark[] }));

  // Windows and doors: this sheet's AI ones are replaced; labels by side (F1, B2, L1, R3).
  const bySide = new Map<string, number>();
  const components: ComponentRow[] = read.components.map((c) => {
    const letter = SIDE_LETTER[c.side] ?? "W";
    const n = (bySide.get(letter) ?? 0) + 1;
    bySide.set(letter, n);
    const placed = c.x > 0 || c.y > 0;
    return {
      id: opts.newId(),
      sheet_id: sheet.id,
      kind: c.kind,
      code: c.code || null,
      width_ft: c.width_ft,
      height_ft: c.height_ft,
      qty: 1,
      side: c.side,
      wall: c.wall,
      label: `${letter}${n}`,
      x: placed ? r2(c.x * k) : null,
      y: placed ? r2(c.y * k) : null,
      ai: true,
      note: c.note || null,
    };
  });

  return {
    newItems,
    addMarks,
    delMarks,
    delItems,
    components,
    counts: { shapes: read.assemblies.length, counted: countedN, reference: refN, skipped, windows: components.length },
  };
}
