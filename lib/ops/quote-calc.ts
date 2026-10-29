// AMBIT-OPS quote math, shared by the quote screen (live numbers), the server (what gets saved), the
// proposal and material orders. Direct margin: cost is materials + labor (with the labor burden) only,
// never overhead. Foam: board feet = sq ft x inches; sets = board feet (+ waste) / yield per set.
// Blown: bags from the maker's coverage chart. Batts: sq ft (+ waste) / sq ft per bag.

import { atticRow, chartFor, chartKeyFor, wallRow } from "@/lib/ops/coverage";
import type { LaborRate, OpsSettings } from "@/lib/ops/defaults";

export type QProduct = {
  id: string;
  kind: string;
  name: string;
  sku: string | null;
  unit: string;
  cost: number | null;
  yield_bf: number | null;
  lb_per_set: number | null;
  r_value: number | null;
  sqft_per_unit: number | null;
  waste_pct: number;
  labor_key: string | null;
  coverage_key: string | null;
  description: string | null;
  price: number | null;
  price_unit: string | null;
  active: boolean;
  product_id: string | null;
  ambit_skus: string[];
};

export type Measure = "sqft" | "lf" | "each" | "hours";

export type QLine = {
  id: string;
  option_id: string | null; // null = add-on
  sort: number;
  area_code: string | null;
  product_id: string | null;
  kind: string;
  name: string;
  detail: string | null;
  measure: Measure;
  sqft: number | null;
  lf: number | null;
  height_ft: number | null;
  qty: number | null;
  depth_in: number | null;
  r_value: number | null;
  framing: string | null;
  hours: number | null;
  waste_pct: number | null;
  units: number | null;
  unit: string | null;
  bf: number | null;
  cost_material: number;
  cost_labor: number;
  price: number;
  price_locked: boolean;
  takeoff_item_id: string | null;
};

export type QOption = { id: string; name: string; note: string | null; sort: number };

export type QuoteParams = {
  price_level: "retail" | "builder";
  target_margin: number | null;
  floor_margin: number | null;
  burden_pct: number | null;
  tax_rate: number | null;
  tax_labor: boolean;
  tax_exempt: boolean;
  deposit_pct: number | null;
  min_job: number | null;
};

export const FOAM_KINDS = ["foam_oc", "foam_cc", "foam_roof", "foam_other"];
export const isFoamKind = (k: string) => FOAM_KINDS.includes(k);

export const KIND_LABEL: Record<string, string> = {
  foam_oc: "Open cell foam",
  foam_cc: "Closed cell foam",
  foam_roof: "Roofing foam",
  foam_other: "Spray foam",
  blown: "Blown fiberglass",
  batt: "Batts",
  bibs_mesh: "BIBS mesh",
  removal: "Insulation removal",
  air_seal: "Air sealing",
  coating: "Roof coating",
  intumescent: "Intumescent coating",
  supply: "Supplies",
  labor: "Labor",
  credit: "Credit or rebate",
  other: "Other",
};

/** How a line of this kind is measured. */
export function measureFor(kind: string): Measure {
  if (kind === "supply" || kind === "other" || kind === "credit") return "each";
  if (kind === "air_seal" || kind === "labor") return "hours";
  return "sqft";
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** R-value from a batt name ("R-19 Kraft 15in") or the product's own field. */
export const battR = (p: Pick<QProduct, "r_value" | "name">) => p.r_value ?? (Number(/\bR-?(\d{1,2})/i.exec(p.name)?.[1]) || null);

/** Which labor rate in Settings a line uses. */
export function laborKeyFor(line: Pick<QLine, "kind" | "framing" | "r_value">, p: Pick<QProduct, "labor_key" | "kind" | "r_value" | "name"> | null): string | null {
  if (p?.labor_key) return p.labor_key;
  const kind = p?.kind ?? line.kind;
  switch (kind) {
    case "foam_oc":
    case "foam_cc":
    case "foam_roof":
      return kind;
    case "foam_other":
      return "foam_oc";
    case "blown":
      return line.framing ? (line.framing === "2x4" ? "bibs_2x4" : "bibs_2x6") : "blown_attic";
    case "batt": {
      const r = (p ? battR(p) : null) ?? line.r_value ?? 0;
      return r <= 15 ? "batt_r11_13" : r <= 21 ? "batt_r19" : "batt_r30_38";
    }
    case "bibs_mesh":
      return "bibs_mesh";
    case "intumescent":
      return "intumescent";
    case "removal":
      return "removal";
    case "air_seal":
      return "air_seal";
    case "labor":
      return "prep";
    default:
      return null;
  }
}

export type LineMath = {
  area: number; // sq ft worked on
  bf: number | null;
  units: number | null; // sets, bags or each (with waste; not rounded)
  unit: string | null;
  cost_material: number;
  cost_labor: number; // with the burden
  labor_parts: { name: string; amount: number }[];
  price: number;
  margin: number | null; // %
  detail: string;
  warn: string | null;
  per_bf: number | null;
  per_sqft: number | null;
};

export const lineArea = (l: Pick<QLine, "measure" | "sqft" | "lf" | "height_ft">) => (l.measure === "lf" ? pos(l.lf) * pos(l.height_ft) : pos(l.sqft));

function laborOf(rate: LaborRate | undefined, q: { sets: number; area: number; bf: number; hours: number }) {
  if (!rate || rate.rate === null || rate.rate === undefined) return null;
  switch (rate.method) {
    case "per_set":
      return q.sets * rate.rate;
    case "per_sqft":
      return q.area * rate.rate;
    case "per_bf":
      return q.bf * rate.rate;
    case "hourly":
      return (q.hours || (rate.hours_per_unit ? rate.hours_per_unit * q.sets : 0)) * rate.rate;
  }
}

/** The margin used to price a quote: the builder margin for builders (if one is set), else the target. */
export const marginFor = (q: Pick<QuoteParams, "price_level" | "target_margin">, s: Pick<OpsSettings, "builder_margin">) =>
  q.price_level === "builder" && s.builder_margin !== null ? s.builder_margin : q.target_margin;

/** Everything about one line: quantities, cost, and the price at the quote's margin (unless typed in). */
export function lineMath(l: QLine, p: QProduct | null, s: Pick<OpsSettings, "labor" | "builder_margin">, q: QuoteParams): LineMath {
  const kind = p?.kind ?? l.kind;
  const area = lineArea(l);
  const waste = (l.waste_pct ?? p?.waste_pct ?? 0) / 100;
  const burden = 1 + pos(q.burden_pct) / 100;
  const rates = new Map(s.labor.map((x) => [x.key, x]));
  const hours = pos(l.hours);
  let bf: number | null = null;
  let units: number | null = null;
  let unit: string | null = p?.unit ?? null;
  let material = 0;
  let warn: string | null = null;
  const parts: { name: string; amount: number }[] = [];
  const bits: string[] = [];

  const cost = p?.cost ?? null;
  if (p && cost === null && !["removal", "air_seal", "labor", "credit"].includes(kind)) warn = `${p.name} has no cost yet (Settings > Products).`;

  if (isFoamKind(kind)) {
    const depth = pos(l.depth_in);
    bf = area * depth;
    const yieldBf = pos(p?.yield_bf);
    units = yieldBf ? (bf * (1 + waste)) / yieldBf : null;
    unit = "set";
    material = units !== null && cost !== null ? units * cost : 0;
    if (!depth) warn = "Add the depth in inches.";
    else if (!yieldBf) warn = `${p?.name ?? "This foam"} has no yield per set.`;
    if (depth) bits.push(`${depth}" ${(KIND_LABEL[kind] ?? "foam").toLowerCase()}`);
    if (l.r_value) bits.push(`R-${l.r_value}`);
  } else if (kind === "blown") {
    const chart = chartFor(p?.coverage_key ?? (p ? chartKeyFor(p.name) : null));
    if (l.framing) {
      const row = chart ? wallRow(chart, l.framing, l.r_value) : null;
      units = row ? ((area * row.bags_per_1000) / 1000) * (1 + waste) : null;
      if (row) bits.push(`${l.framing} walls dense-packed, R-${row.r}`);
      else warn = chart ? `${chart.product} has no ${l.framing} wall coverage.` : "Pick a blown product with a coverage chart.";
    } else {
      const row = chart ? atticRow(chart, l.r_value) : null;
      units = row ? ((area * row.bags_per_1000) / 1000) * (1 + waste) : null;
      if (row) bits.push(`R-${row.r} at ${row.inches}" (${row.bags_per_1000} bags per 1,000 sq ft)`);
      else warn = !l.r_value ? "Pick the R-value." : chart ? null : "Pick a blown product with a coverage chart.";
    }
    unit = "bag";
    material = units !== null && cost !== null ? units * cost : 0;
  } else if (kind === "batt") {
    const per = pos(p?.sqft_per_unit);
    units = per ? (area * (1 + waste)) / per : null;
    unit = p?.unit || "bag";
    material = units !== null && cost !== null ? units * cost : 0;
    const r = p ? battR(p) : l.r_value;
    if (r) bits.push(`R-${r} batts`);
    if (!per) warn = `${p?.name ?? "This batt"} needs its sq ft per bag (Settings > Products).`;
  } else if (["coating", "intumescent"].includes(kind)) {
    const per = pos(p?.sqft_per_unit);
    units = per ? (area * (1 + waste)) / per : null;
    material = units !== null && cost !== null ? units * cost : 0;
  } else if (["supply", "other"].includes(kind)) {
    units = pos(l.qty);
    unit = p?.unit ?? "each";
    material = cost !== null ? units * cost : 0;
  } else if (kind === "credit") {
    units = null;
  }

  // Labor: the rate for this kind of work in Settings, plus mesh for blown walls (paid on its own).
  const key = laborKeyFor(l, p);
  const sets = unit === "set" ? units ?? 0 : 0;
  const main = laborOf(key ? rates.get(key) : undefined, { sets, area, bf: bf ?? 0, hours });
  if (main !== null && main !== undefined) parts.push({ name: rates.get(key!)?.name ?? "Labor", amount: main });
  else if (key && !["credit"].includes(kind) && (area || hours || sets)) {
    const r = rates.get(key);
    if (r && r.rate === null) warn = warn ?? `No labor rate for ${r.name} (Settings > Pricing).`;
  }
  if (kind === "blown" && l.framing) {
    const mesh = laborOf(rates.get("bibs_mesh"), { sets: 0, area, bf: 0, hours: 0 });
    if (mesh) parts.push({ name: rates.get("bibs_mesh")?.name ?? "Mesh", amount: mesh });
  }
  const labor = parts.reduce((a, x) => a + x.amount, 0) * burden;
  const costAll = material + labor;

  const m = marginFor(q, s);
  let price = l.price;
  if (!l.price_locked && kind !== "credit") price = m !== null && m < 100 ? r2(costAll / (1 - m / 100)) : r2(l.price || 0);
  if (kind === "credit") price = -Math.abs(l.price || 0);
  const margin = price > 0 ? ((price - costAll) / price) * 100 : null;
  if (area && ["foam_oc", "foam_cc", "foam_roof", "foam_other", "blown", "batt", "removal", "coating", "intumescent"].includes(kind)) bits.unshift(`${Math.round(area).toLocaleString("en-US")} sq ft`);
  if (kind === "supply" || kind === "other") bits.unshift(`${pos(l.qty).toLocaleString("en-US")} ${p?.unit ?? "each"}`);
  if (hours && (kind === "air_seal" || kind === "labor")) bits.unshift(`${hours} hr`);

  return {
    area,
    bf,
    units,
    unit,
    cost_material: r2(material),
    cost_labor: r2(labor),
    labor_parts: parts.map((x) => ({ ...x, amount: r2(x.amount * burden) })),
    price,
    margin,
    detail: bits.join(" · "),
    warn,
    per_bf: bf && price ? price / bf : null,
    per_sqft: area && price ? price / area : null,
  };
}

export type OptionTotals = { price: number; cost: number; margin: number | null; min_adj: number; tax: number; total: number; deposit: number };
export type AddonTotals = { price: number; cost: number; tax: number; total: number };
export type QuoteTotals = { options: Record<string, OptionTotals>; addons: Record<string, AddonTotals>; below_floor: string[] };

/** The tax on a line: all of it, or just the materials' share (if labor isn't taxed). */
function taxOf(price: number, mat: number, lab: number, q: QuoteParams) {
  if (q.tax_exempt || !q.tax_rate) return 0;
  const taxable = q.tax_labor || mat + lab <= 0 ? price : price * (mat / (mat + lab));
  return r2((taxable * q.tax_rate) / 100);
}

/** Option totals, add-on totals, and which options are under the lowest margin. */
export function quoteTotals(options: QOption[], lines: QLine[], q: QuoteParams): QuoteTotals {
  const out: QuoteTotals = { options: {}, addons: {}, below_floor: [] };
  for (const o of options) {
    const mine = lines.filter((l) => l.option_id === o.id);
    let price = mine.reduce((a, l) => a + l.price, 0);
    const cost = mine.reduce((a, l) => a + l.cost_material + l.cost_labor, 0);
    let tax = mine.reduce((a, l) => a + taxOf(l.price, l.cost_material, l.cost_labor, q), 0);
    const min = pos(q.min_job);
    const minAdj = price > 0 && min > price ? r2(min - price) : 0;
    if (minAdj) {
      tax += taxOf(minAdj, 1, 0, { ...q, tax_labor: true });
      price += minAdj;
    }
    price = r2(price);
    tax = r2(tax);
    const total = r2(price + tax);
    const margin = price > 0 ? ((price - cost) / price) * 100 : null;
    out.options[o.id] = { price, cost: r2(cost), margin, min_adj: minAdj, tax, total, deposit: r2((total * pos(q.deposit_pct)) / 100) };
    if (q.floor_margin !== null && margin !== null && margin < q.floor_margin - 0.0001) out.below_floor.push(o.id);
  }
  for (const l of lines.filter((x) => x.option_id === null)) {
    const tax = taxOf(l.price, l.cost_material, l.cost_labor, q);
    out.addons[l.id] = { price: r2(l.price), cost: r2(l.cost_material + l.cost_labor), tax, total: r2(l.price + tax) };
  }
  return out;
}

export const money = (n: number | null | undefined, cents = true) =>
  n === null || n === undefined || !Number.isFinite(n) ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
export const pct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "–" : `${n.toFixed(1)}%`);

/** A blank line of a kind, ready to fill in. */
export function newLine(o: Partial<QLine> & { id: string }): QLine {
  const kind = o.kind ?? "other";
  return {
    option_id: null,
    sort: 0,
    area_code: null,
    product_id: null,
    kind,
    name: KIND_LABEL[kind] ?? "Item",
    detail: null,
    measure: measureFor(kind),
    sqft: null,
    lf: null,
    height_ft: null,
    qty: null,
    depth_in: null,
    r_value: null,
    framing: null,
    hours: null,
    waste_pct: null,
    units: null,
    unit: null,
    bf: null,
    cost_material: 0,
    cost_labor: 0,
    price: 0,
    price_locked: false,
    takeoff_item_id: null,
    ...o,
  };
}

/** Recomputes every line (sizes, costs and prices) for saving or showing. */
export function priceLines(lines: QLine[], products: Map<string, QProduct>, s: Pick<OpsSettings, "labor" | "builder_margin">, q: QuoteParams): QLine[] {
  return lines.map((l) => {
    const p = l.product_id ? products.get(l.product_id) ?? null : null;
    const m = lineMath(l, p, s, q);
    return {
      ...l,
      kind: p?.kind ?? l.kind,
      detail: m.detail || l.detail,
      bf: m.bf === null ? null : Math.round(m.bf * 10) / 10,
      units: m.units === null ? null : Math.round(m.units * 1000) / 1000,
      unit: m.unit,
      cost_material: m.cost_material,
      cost_labor: m.cost_labor,
      price: m.price,
    };
  });
}
