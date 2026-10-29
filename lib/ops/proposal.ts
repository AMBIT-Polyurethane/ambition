// The customer's proposal (what ops_proposal returns), shared by the proposal page and its PDF.

import { DEFAULT_WORK_AREAS, type WorkArea } from "@/lib/ops/defaults";

export type PLine = {
  id: string;
  option_id: string | null;
  area_code: string | null;
  kind: string;
  name: string;
  detail: string | null;
  measure: string;
  sqft: number | null;
  lf: number | null;
  qty: number | null;
  bf: number | null;
  depth_in: number | null;
  r_value: number | null;
  price: number;
  product_id: string | null;
};

export type Proposal = {
  quote: {
    id: string;
    number: number;
    title: string | null;
    status: "draft" | "sent" | "viewed" | "signed" | "declined";
    intro: string | null;
    terms: string | null;
    valid_until: string | null;
    sent_at: string | null;
    tax_rate: number | null;
    tax_exempt: boolean;
    deposit_pct: number | null;
    totals: { options?: Record<string, { price: number; tax: number; total: number; deposit: number; min_adj: number }>; addons?: Record<string, { price: number; tax: number; total: number }> };
    signed_at: string | null;
    signed_name: string | null;
    signature: string | null;
    signed_option_id: string | null;
    signed_addons: string[] | null;
    signed_total: number | null;
    declined_at: string | null;
  };
  company: { name: string; logo_path: string | null; phone: string | null; email: string | null; website: string | null; address: string | null; license_no: string | null; color: string | null; show_line_prices: boolean; work_areas: WorkArea[] | null };
  customer: { name: string; email: string | null; phone: string | null } | null;
  property: { street: string | null; city: string | null; state: string | null; zip: string | null } | null;
  options: { id: string; name: string; note: string | null }[];
  lines: PLine[];
};

export function proposalOf(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== "object" || !(raw as Proposal).quote) return null;
  const p = raw as Proposal;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...p,
    quote: { ...p.quote, tax_rate: num(p.quote.tax_rate), deposit_pct: num(p.quote.deposit_pct), signed_total: num(p.quote.signed_total), totals: p.quote.totals ?? {} },
    lines: (p.lines ?? []).map((l) => ({ ...l, price: Number(l.price ?? 0), sqft: num(l.sqft), lf: num(l.lf), qty: num(l.qty), bf: num(l.bf), depth_in: num(l.depth_in), r_value: num(l.r_value) })),
  };
}

export const areaNameOf = (areas: WorkArea[] | null, code: string | null) => (code ? (areas ?? DEFAULT_WORK_AREAS).find((a) => a.code === code)?.name ?? code : null);

/** Lines grouped by work area, in the contractor's work-area order. */
export function groupByArea(lines: PLine[], areas: WorkArea[] | null) {
  const order = (areas ?? DEFAULT_WORK_AREAS).map((a) => a.code);
  const groups = new Map<string, PLine[]>();
  for (const l of lines) {
    const k = l.area_code ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l);
  }
  return [...groups.entries()]
    .sort((a, b) => (order.indexOf(a[0]) < 0 ? 98 : order.indexOf(a[0])) - (order.indexOf(b[0]) < 0 ? 98 : order.indexOf(b[0])))
    .map(([code, ls]) => ({ code: code || null, name: areaNameOf(areas, code || null) ?? "Other", lines: ls, total: ls.reduce((a, l) => a + l.price, 0) }));
}

export const isExpired = (p: Proposal) => !!p.quote.valid_until && p.quote.valid_until < new Date().toISOString().slice(0, 10) && ["sent", "viewed"].includes(p.quote.status);
