import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemTotals, type TItem, type TMark, type TSheet } from "@/lib/takeoff/calc";
import { battR, isFoamKind, newLine, type QLine, type QOption, type QProduct, type QuoteParams } from "@/lib/ops/quote-calc";
import { chartFor, wallFramings } from "@/lib/ops/coverage";
import { starterProducts } from "@/lib/ops/seed";
import type { OpsSettings } from "@/lib/ops/defaults";

// AMBIT-OPS quotes: loading them, and turning a takeoff into quote lines.

export type QuoteRow = {
  id: string;
  company_id: string;
  number: number;
  lead_id: string | null;
  customer_id: string;
  property_id: string | null;
  takeoff_id: string | null;
  title: string | null;
  status: "draft" | "sent" | "viewed" | "signed" | "declined";
  price_level: "retail" | "builder";
  target_margin: number | null;
  floor_margin: number | null;
  burden_pct: number | null;
  tax_rate: number | null;
  tax_labor: boolean;
  tax_exempt: boolean;
  deposit_pct: number | null;
  intro: string | null;
  terms: string | null;
  valid_until: string | null;
  public_token: string | null;
  rep_id: string | null;
  created_by: string | null;
  needs_approval: boolean;
  approved_by_name: string | null;
  approved_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  view_count: number;
  signed_at: string | null;
  signed_name: string | null;
  signed_email: string | null;
  signature: string | null;
  signed_option_id: string | null;
  signed_addons: string[];
  signed_total: number | null;
  signed_method: string | null;
  signed_note: string | null;
  signed_by_name: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  totals: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const QUOTE_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "pill grey" },
  sent: { label: "Sent", cls: "pill warn" },
  viewed: { label: "Opened", cls: "pill info" },
  signed: { label: "Signed", cls: "pill ok" },
  declined: { label: "Declined", cls: "pill grey" },
};

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export const PRODUCT_COLS = "id, kind, name, sku, unit, cost, yield_bf, lb_per_set, r_value, sqft_per_unit, waste_pct, labor_key, coverage_key, description, price, price_unit, active, product_id, ambit_skus, sort";

export function toProduct(r: Record<string, unknown>): QProduct {
  return {
    id: String(r.id),
    kind: String(r.kind),
    name: String(r.name),
    sku: (r.sku as string | null) ?? null,
    unit: String(r.unit ?? "each"),
    cost: n(r.cost),
    yield_bf: n(r.yield_bf),
    lb_per_set: n(r.lb_per_set),
    r_value: n(r.r_value),
    sqft_per_unit: n(r.sqft_per_unit),
    waste_pct: Number(r.waste_pct ?? 0),
    labor_key: (r.labor_key as string | null) ?? null,
    coverage_key: (r.coverage_key as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    price: n(r.price),
    price_unit: (r.price_unit as string | null) ?? null,
    active: r.active !== false,
    product_id: (r.product_id as string | null) ?? null,
    ambit_skus: (r.ambit_skus as string[] | null) ?? [],
  };
}

export async function loadProducts(supabase: SupabaseClient, companyId: string): Promise<QProduct[]> {
  const { data } = await supabase.from("ops_products").select(PRODUCT_COLS).eq("company_id", companyId).order("sort").order("name");
  return ((data ?? []) as Record<string, unknown>[]).map(toProduct);
}

export function toLine(r: Record<string, unknown>): QLine {
  return {
    id: String(r.id),
    option_id: (r.option_id as string | null) ?? null,
    sort: Number(r.sort ?? 0),
    area_code: (r.area_code as string | null) ?? null,
    product_id: (r.product_id as string | null) ?? null,
    kind: String(r.kind ?? "other"),
    name: String(r.name ?? ""),
    detail: (r.detail as string | null) ?? null,
    measure: (r.measure as QLine["measure"]) ?? "sqft",
    sqft: n(r.sqft),
    lf: n(r.lf),
    height_ft: n(r.height_ft),
    qty: n(r.qty),
    depth_in: n(r.depth_in),
    r_value: n(r.r_value),
    framing: (r.framing as string | null) ?? null,
    hours: n(r.hours),
    waste_pct: n(r.waste_pct),
    units: n(r.units),
    unit: (r.unit as string | null) ?? null,
    bf: n(r.bf),
    cost_material: Number(r.cost_material ?? 0),
    cost_labor: Number(r.cost_labor ?? 0),
    price: Number(r.price ?? 0),
    price_locked: r.price_locked === true,
    takeoff_item_id: (r.takeoff_item_id as string | null) ?? null,
  };
}

export function quoteParams(q: Pick<QuoteRow, "price_level" | "target_margin" | "floor_margin" | "burden_pct" | "tax_rate" | "tax_labor" | "tax_exempt" | "deposit_pct">, s: Pick<OpsSettings, "min_job">): QuoteParams {
  return {
    price_level: q.price_level === "builder" ? "builder" : "retail",
    target_margin: n(q.target_margin),
    floor_margin: n(q.floor_margin),
    burden_pct: n(q.burden_pct),
    tax_rate: n(q.tax_rate),
    tax_labor: !!q.tax_labor,
    tax_exempt: !!q.tax_exempt,
    deposit_pct: n(q.deposit_pct),
    min_job: s.min_job,
  };
}

export async function loadQuote(supabase: SupabaseClient, id: string) {
  const { data: q } = await supabase.from("ops_quotes").select("*").eq("id", id).maybeSingle();
  if (!q) return null;
  const [{ data: options }, { data: lines }] = await Promise.all([
    supabase.from("ops_quote_options").select("id, name, note, sort").eq("quote_id", id).order("sort"),
    supabase.from("ops_quote_lines").select("*").eq("quote_id", id).order("sort"),
  ]);
  const quote = {
    ...(q as QuoteRow),
    target_margin: n(q.target_margin),
    floor_margin: n(q.floor_margin),
    burden_pct: n(q.burden_pct),
    tax_rate: n(q.tax_rate),
    deposit_pct: n(q.deposit_pct),
    signed_total: n(q.signed_total),
  } as QuoteRow;
  return {
    quote,
    options: ((options ?? []) as QOption[]).map((o) => ({ ...o, note: o.note ?? null })),
    lines: ((lines ?? []) as Record<string, unknown>[]).map(toLine),
  };
}

// ------------------------------------------------------------------ takeoff to quote lines
/** Work area from a takeoff item's name when it doesn't have one. */
export function guessArea(name: string, kind: string, codes: string[]): string | null {
  const t = name.toLowerCase();
  const pick = (c: string) => (codes.includes(c) ? c : null);
  if (/rim|band/.test(t)) return pick("RJ");
  if (/knee/.test(t)) return pick("KW");
  if (/roof|deck|vault|cathedral|gable|demising|rafter/.test(t)) return pick("RL");
  if (/ceiling|attic floor|attic|flat/.test(t)) return pick("CL");
  if (/partition|interior|bath|sound/.test(t)) return pick("PW");
  if (/wall|exterior|garage/.test(t) || kind === "linear") return pick("EW");
  return null;
}

const rOf = (s: string | null | undefined) => {
  const m = /(\d{1,2}(?:\.\d)?)/.exec(String(s ?? ""));
  return m ? Number(m[1]) : null;
};

const FRIENDLY: Record<string, string> = {
  foam_oc: "Open cell spray foam",
  foam_cc: "Closed cell spray foam",
  foam_roof: "Spray foam roofing",
  foam_other: "Spray foam insulation",
  blown: "Blown-in fiberglass insulation",
  batt: "Fiberglass batt insulation",
  coating: "Roof coating",
  intumescent: "Intumescent (thermal barrier) coating",
  removal: "Remove existing insulation",
  air_seal: "Air sealing",
  supply: "Materials",
  bibs_mesh: "BIBS netting",
  labor: "Labor",
  credit: "Credit",
  other: "Other",
};
/** What the customer reads for a line of this product. */
export const lineName = (p: Pick<QProduct, "kind" | "description" | "name"> | null, kind: string) =>
  p?.description || (p && ["supply", "other", "coating"].includes(p.kind) ? p.name : FRIENDLY[p?.kind ?? kind] ?? p?.name ?? "Item");

/** The product to use for a takeoff material: the first one turned on of that kind (a batt by its R-value). */
/** Winter blends from November through March, summer the rest of the year (when both are in the library). */
export function seasonal(list: QProduct[], kind: string): QProduct | null {
  const m = Number(new Date().toLocaleDateString("en-US", { month: "numeric", timeZone: "America/Chicago" }));
  const want = m >= 11 || m <= 3 ? /winter/i : /summer/i;
  const of = list.filter((p) => p.kind === kind);
  return of.find((p) => want.test(p.name)) ?? of[0] ?? null;
}

function productFor(material: string | null, r: number | null, products: QProduct[]): QProduct | null {
  const on = products.filter((p) => p.active);
  const first = (k: string) => (k.startsWith("foam") ? seasonal(on, k) : on.find((p) => p.kind === k) ?? null);
  switch (material) {
    case "open_cell":
      return first("foam_oc");
    case "closed_cell":
      return first("foam_cc");
    case "blown_fiberglass":
      return on.find((p) => p.kind === "blown" && p.coverage_key && p.cost !== null) ?? on.find((p) => p.kind === "blown" && p.coverage_key) ?? first("blown");
    case "fiberglass_batts": {
      const batts = on.filter((p) => p.kind === "batt");
      return (r ? batts.find((p) => battR(p) === r) : null) ?? batts[0] ?? null;
    }
    case "coating":
      return first("coating");
    default:
      return null;
  }
}

/** Quote lines from a takeoff: one per measured item, in its work area, with the right product picked. */
export async function linesFromTakeoff(supabase: SupabaseClient, takeoffId: string, products: QProduct[], settings: Pick<OpsSettings, "work_areas" | "waste_pct">) {
  const [{ data: s }, { data: i }, { data: m }] = await Promise.all([
    supabase.from("takeoff_sheets").select("*").eq("takeoff_id", takeoffId),
    supabase.from("takeoff_items").select("*").eq("takeoff_id", takeoffId).order("sort").order("created_at"),
    supabase.from("takeoff_marks").select("id, item_id, sheet_id, points, cutout").eq("takeoff_id", takeoffId).range(0, 19999),
  ]);
  const sheets = new Map(((s ?? []) as TSheet[]).map((x) => [x.id, { ...x, ft_per_pt: n(x.ft_per_pt) }]));
  const marks = (m ?? []) as TMark[];
  const codes = settings.work_areas.map((a) => a.code);
  const out: QLine[] = [];
  const skipped: string[] = [];
  for (const raw of (i ?? []) as TItem[]) {
    const it: TItem = { ...raw, thickness_in: n(raw.thickness_in), height_ft: n(raw.height_ft), pitch: n(raw.pitch), deduct_sqft: Number(raw.deduct_sqft ?? 0) };
    const t = itemTotals(it, marks, sheets);
    const r = rOf(it.r_value);
    const p = productFor(it.material, r, products);
    const area = it.area_code && codes.includes(it.area_code) ? it.area_code : guessArea(it.name, it.kind, codes);
    if (it.kind === "count") {
      if (!t.count) continue;
      out.push(newLine({ id: crypto.randomUUID(), kind: "other", measure: "each", name: it.name, qty: t.count, area_code: area, takeoff_item_id: it.id, sort: out.length }));
      continue;
    }
    if (!t.sqft) {
      skipped.push(it.name);
      continue;
    }
    const kind = p?.kind ?? (it.material === "open_cell" ? "foam_oc" : it.material === "closed_cell" ? "foam_cc" : it.material === "blown_fiberglass" ? "blown" : it.material === "fiberglass_batts" ? "batt" : "other");
    const chart = kind === "blown" ? chartFor(p?.coverage_key) : null;
    const walls = kind === "blown" && it.kind === "linear";
    const framing = walls ? (it.thickness_in && it.thickness_in >= 5 ? "2x6" : "2x4") : null;
    out.push(
      newLine({
        id: crypto.randomUUID(),
        kind,
        product_id: p?.id ?? null,
        name: (it.name ? `${it.name}: ${lineName(p, kind).toLowerCase()}` : lineName(p, kind)).slice(0, 160),
        area_code: area,
        measure: kind === "other" ? "each" : "sqft",
        sqft: kind === "other" ? null : Math.round(t.sqft),
        qty: kind === "other" ? Math.round(t.sqft) : null,
        depth_in: isFoamKind(kind) ? it.thickness_in : null,
        r_value: r,
        framing: walls && chart && wallFramings(chart).includes(framing as never) ? framing : walls ? framing : null,
        takeoff_item_id: it.id,
        sort: out.length,
      }),
    );
  }
  return { lines: out, skipped };
}

/** For AMBIT staff takeoffs (no contractor product library): AMBIT's foam sets and fiberglass, as products. */
export async function catalogProducts(supabase: SupabaseClient, companyId: string | null): Promise<QProduct[]> {
  const list = await starterProducts(supabase, companyId ?? "00000000-0000-0000-0000-000000000000");
  return list.map((p, i) => ({
    id: p.product_id ?? `x-${i}`,
    kind: p.kind,
    name: p.name,
    sku: p.sku,
    unit: p.unit,
    cost: p.cost,
    yield_bf: p.yield_bf,
    lb_per_set: p.lb_per_set,
    r_value: p.r_value,
    sqft_per_unit: p.sqft_per_unit,
    waste_pct: p.waste_pct,
    labor_key: null,
    coverage_key: p.coverage_key,
    description: null,
    price: null,
    price_unit: p.price_unit,
    active: p.active,
    product_id: p.product_id,
    ambit_skus: p.ambit_skus,
  }));
}
