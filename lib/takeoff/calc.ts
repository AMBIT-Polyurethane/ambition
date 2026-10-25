// Takeoff math, shared by the workspace (live numbers) and the report.
// Shapes are stored in PDF points (1/72 inch); each sheet's scale turns points into feet.

export type Pt = [number, number];

export type TSheet = {
  id: string;
  file_id: string;
  page: number;
  name: string | null;
  width_pt: number | null;
  height_pt: number | null;
  ft_per_pt: number | null;
  scale_label: string | null;
  scale_source: string | null;
  sort: number;
};

export type TItem = {
  id: string;
  name: string;
  kind: "area" | "linear" | "count";
  color: string;
  material: string | null;
  thickness_in: number | null;
  r_value: string | null;
  height_ft: number | null;
  pitch: number | null;
  deduct_sqft: number;
  hidden: boolean;
  sort: number;
};

export type TMark = { id: string; item_id: string; sheet_id: string; points: Pt[]; cutout: boolean };

export const STATUS_TEXT: Record<string, { label: string; cls: string }> = {
  in_progress: { label: "In progress", cls: "pill warn" },
  sent: { label: "Sent", cls: "pill grey" },
  won: { label: "Won", cls: "pill ok" },
  lost: { label: "Lost", cls: "pill grey" },
};

export const MATERIALS = [
  { id: "open_cell", label: "Open-cell spray foam", foam: true },
  { id: "closed_cell", label: "Closed-cell spray foam", foam: true },
  { id: "blown_fiberglass", label: "Blown fiberglass", foam: false },
  { id: "fiberglass_batts", label: "Fiberglass batts", foam: false },
  { id: "blown_cellulose", label: "Blown cellulose", foam: false },
  { id: "mineral_wool", label: "Mineral wool", foam: false },
  { id: "rigid_board", label: "Rigid board", foam: false },
  { id: "coating", label: "Coating / sealant", foam: false },
  { id: "other", label: "Other", foam: false },
] as const;

export const materialLabel = (m: string | null | undefined) => MATERIALS.find((x) => x.id === m)?.label ?? "No material";
export const isFoam = (m: string | null | undefined) => Boolean(MATERIALS.find((x) => x.id === m)?.foam);

export const COLORS = ["#e33527", "#2563eb", "#7c3aed", "#d97706", "#0d9488", "#db2777", "#16a34a", "#0891b2", "#4f46e5", "#ca8a04"];

// Common plan scales: paper inches -> real feet per inch.
export const SCALES: { label: string; ftPerIn: number }[] = [
  { label: '1/16" = 1\'-0"', ftPerIn: 16 },
  { label: '3/32" = 1\'-0"', ftPerIn: 32 / 3 },
  { label: '1/8" = 1\'-0"', ftPerIn: 8 },
  { label: '3/16" = 1\'-0"', ftPerIn: 16 / 3 },
  { label: '1/4" = 1\'-0"', ftPerIn: 4 },
  { label: '3/8" = 1\'-0"', ftPerIn: 8 / 3 },
  { label: '1/2" = 1\'-0"', ftPerIn: 2 },
  { label: '3/4" = 1\'-0"', ftPerIn: 4 / 3 },
  { label: '1" = 1\'-0"', ftPerIn: 1 },
  { label: '1" = 10\'', ftPerIn: 10 },
  { label: '1" = 20\'', ftPerIn: 20 },
  { label: '1" = 30\'', ftPerIn: 30 },
  { label: '1" = 40\'', ftPerIn: 40 },
  { label: '1" = 50\'', ftPerIn: 50 },
  { label: '1" = 100\'', ftPerIn: 100 },
];
export const ftPerPt = (ftPerIn: number) => ftPerIn / 72;

export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function polylineLength(p: Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

export const pitchFactor = (rise: number | null | undefined) => (rise && rise > 0 ? Math.sqrt(1 + (rise / 12) ** 2) : 1);

/** One shape's raw size: square feet (area, before pitch) or feet (linear) or 1 (count). */
export function markSize(m: TMark, kind: TItem["kind"], ftPt: number | null): number | null {
  if (kind === "count") return m.points.length;
  if (!ftPt) return null;
  if (kind === "area") return polygonArea(m.points) * ftPt * ftPt;
  return polylineLength(m.points) * ftPt;
}

export type Totals = {
  sqft: number | null; // area items, and linear items with a wall height
  lf: number | null; // linear items
  count: number | null; // count items
  bf: number | null; // spray foam: square feet x inches
  marks: number;
  unscaled: number; // shapes on sheets with no scale (left out)
};

/** Totals for one item, over every sheet or just one. */
export function itemTotals(item: TItem, marks: TMark[], sheets: Map<string, TSheet>, onlySheet?: string): Totals {
  const mine = marks.filter((m) => m.item_id === item.id && (!onlySheet || m.sheet_id === onlySheet));
  let area = 0;
  let lf = 0;
  let count = 0;
  let unscaled = 0;
  for (const m of mine) {
    const s = sheets.get(m.sheet_id);
    const size = markSize(m, item.kind, s?.ft_per_pt ? Number(s.ft_per_pt) : null);
    if (size === null) {
      unscaled++;
      continue;
    }
    if (item.kind === "area") area += m.cutout ? -size : size;
    else if (item.kind === "linear") lf += m.cutout ? -size : size;
    else count += size;
  }
  const out: Totals = { sqft: null, lf: null, count: null, bf: null, marks: mine.length, unscaled };
  if (item.kind === "area") out.sqft = Math.max(0, area) * pitchFactor(item.pitch);
  if (item.kind === "linear") {
    out.lf = Math.max(0, lf);
    if (item.height_ft && item.height_ft > 0) {
      // Openings come out of the whole item, not out of one sheet's share.
      const deduct = onlySheet ? 0 : Number(item.deduct_sqft || 0);
      out.sqft = Math.max(0, out.lf * Number(item.height_ft) - deduct);
    }
  }
  if (item.kind === "count") out.count = count;
  if (out.sqft !== null && isFoam(item.material) && item.thickness_in) out.bf = out.sqft * Number(item.thickness_in);
  return out;
}

// ------------------------------------------------------------------ display
export const num = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

/** 12.333 -> 12'-4" */
export function feetInches(ft: number): string {
  const neg = ft < 0;
  let total = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(total / 12);
  total -= f * 12;
  return `${neg ? "-" : ""}${f.toLocaleString("en-US")}'-${total}"`;
}

/** The headline quantity for an item: "1,244 sq ft", "162 ft", "14 each". */
export function mainQty(item: TItem, t: Totals): string {
  if (item.kind === "count") return `${num(t.count ?? 0)} each`;
  if (t.sqft !== null) return `${num(t.sqft)} sq ft`;
  if (t.lf !== null) return `${num(t.lf, 1)} ft`;
  return "–";
}

export function subQty(item: TItem, t: Totals): string {
  const bits: string[] = [];
  if (item.kind === "linear" && t.lf !== null && t.sqft !== null) bits.push(`${num(t.lf, 1)} ft × ${feetInches(Number(item.height_ft))}`);
  if (t.bf !== null) bits.push(`${num(t.bf)} board ft`);
  if (t.unscaled) bits.push(`${t.unscaled} on sheets with no scale`);
  return bits.join(" · ");
}

export function assembly(item: TItem): string {
  const bits = [materialLabel(item.material)];
  if (item.thickness_in) bits.push(`${num(Number(item.thickness_in), 2)}"`);
  if (item.r_value) bits.push(/^r-?/i.test(item.r_value) ? item.r_value.toUpperCase().replace(/^R(?!-)/, "R-") : `R-${item.r_value}`);
  if (item.pitch) bits.push(`${num(Number(item.pitch), 1)}/12 pitch`);
  return item.material || item.thickness_in || item.r_value ? bits.join(" · ") : "";
}

/** Reads a typed length: 12'-6", 12' 6", 12.5, 150" -> feet. */
export function parseLength(t: string): number | null {
  const s = t.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return null;
  const fi = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i.exec(s);
  if (fi) return Number(fi[1]) + (fi[2] ? Number(fi[2]) / 12 : 0);
  const inch = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/i.exec(s);
  if (inch) return Number(inch[1]) / 12;
  const ft = /^(\d+(?:\.\d+)?)\s*(?:ft|feet)?$/i.exec(s);
  if (ft) return Number(ft[1]);
  return null;
}

/** A plan's scale written on the sheet: 1/4" = 1'-0", 1" = 20'. Returns feet per inch. */
export function readScale(text: string): { label: string; ftPerIn: number } | null {
  const t = text
    .replace(/[’′]/g, "'")
    .replace(/[”″“]/g, '"')
    .replace(/¼/g, "1/4").replace(/½/g, "1/2").replace(/¾/g, "3/4")
    .replace(/⅛/g, "1/8").replace(/⅜/g, "3/8").replace(/⅝/g, "5/8").replace(/⅞/g, "7/8")
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2");
  const arch = /(\d+\/\d+|\d+(?:\.\d+)?)\s*"?\s*=\s*1\s*'\s*-?\s*0?\s*"?/g;
  const eng = /\b1\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'/g;
  const found: { label: string; ftPerIn: number }[] = [];
  for (const m of t.matchAll(arch)) {
    const frac = m[1].includes("/") ? Number(m[1].split("/")[0]) / Number(m[1].split("/")[1]) : Number(m[1]);
    if (frac > 0 && frac <= 3) found.push({ label: `${m[1]}" = 1'-0"`, ftPerIn: 1 / frac });
  }
  for (const m of t.matchAll(eng)) {
    const ft = Number(m[1]);
    if (ft >= 2 && ft <= 1000) found.push({ label: `1" = ${m[1]}'`, ftPerIn: ft });
  }
  if (!found.length) return null;
  // The scale that shows up most often on the sheet (the main drawing's, not a detail's).
  const tally = new Map<string, { s: { label: string; ftPerIn: number }; n: number }>();
  for (const f of found) tally.set(f.label, { s: f, n: (tally.get(f.label)?.n ?? 0) + 1 });
  return [...tally.values()].sort((a, b) => b.n - a.n)[0].s;
}
