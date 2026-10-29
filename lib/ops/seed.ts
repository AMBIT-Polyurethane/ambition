import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { foamOf, lastPricesFrom, type LastPrice, type LastPrices, type PricePart } from "@/lib/order-doc/loads";
import { DEFAULT_SETTINGS, YIELD_DEFAULTS } from "@/lib/ops/defaults";
import { dateShort, orderNo } from "@/lib/format";

// AMBIT-OPS: the product library a contractor starts with, built from AMBIT's catalog and the prices
// on the contractor's own AMBIT invoices (the order desk's invoice prices). Foam becomes sets
// (ISO + that resin); blown fiberglass always; batts they've bought before. Everything else is added
// from the AMBIT catalog when they first quote it.

export type StarterProduct = {
  product_id: string | null;
  ambit_skus: string[];
  kind: string;
  name: string;
  sku: string | null;
  unit: string;
  cost: number | null;
  cost_source: "ambit" | "manual";
  cost_note: string | null;
  yield_bf: number | null;
  lb_per_set: number | null;
  r_value: number | null;
  sqft_per_unit: number | null;
  waste_pct: number;
  price_unit: string | null;
  active: boolean;
};

type CatalogRow = { id: string; sku: string; name: string; unit: string; category_id: string | null; sqft_per_unit: number | null };

const ISO_LB = 500;
/** Resin drum weights from AMBIT invoices: AMBI-SEAL 5.0 450 lb, AMBI-TITE 204 HFO 475 lb (editable). */
const resinLb = (sku: string) => (/^AMB-SEAL/i.test(sku) ? 450 : 475);

const FOAM_LINES: { re: RegExp; kind: string; label: string; always: boolean }[] = [
  { re: /^AMB-SEAL/i, kind: "foam_oc", label: "open cell", always: true },
  { re: /^AMB-TITE/i, kind: "foam_cc", label: "closed cell", always: true },
  { re: /^AMB-ROOF/i, kind: "foam_roof", label: "roofing foam", always: false },
  { re: /^AMB-JACK/i, kind: "foam_other", label: "spray foam", always: false },
];

const isBlown = (n: string) => /jet ?stream|climate ?pro|blow|loose.?fill|\bL77\b/i.test(n);
const rOf = (n: string) => {
  const m = /\bR-?(\d{1,2})/i.exec(n);
  return m ? Number(m[1]) : null;
};

/** The latest price on any of the contractor's priced AMBIT orders (newest first). */
export async function ambitPrices(supabase: SupabaseClient, companyId: string): Promise<LastPrices> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, priced_at")
    .eq("company_id", companyId)
    .neq("status", "cancelled")
    .not("priced_at", "is", null)
    .order("priced_at", { ascending: false })
    .limit(60);
  if (!orders?.length) return { sku: {}, iso: {} };
  const { data: items } = await supabase
    .from("order_items")
    .select("id, order_id, sku, name, unit, qty, unit_price, price_parts, product:products!order_items_product_id_fkey(category_id)")
    .in("order_id", orders.map((o) => o.id));
  type Row = { id: number; order_id: string; sku: string; name: string; unit: string; qty: number; unit_price: number | null; price_parts: PricePart[] | null; product: { category_id: string | null } | null };
  const rows = ((items ?? []) as unknown as Row[]).map(({ product, ...i }) => ({ ...i, foam: foamOf(i, product?.category_id) }));
  return lastPricesFrom(orders as { id: string; order_no: number; priced_at: string | null }[], rows);
}

const note = (p: LastPrice) => `From your AMBIT invoice on ${orderNo(p.order)} (${dateShort(p.on)})`;
const key = (s: string) => s.trim().toUpperCase();

export async function starterProducts(supabase: SupabaseClient, companyId: string): Promise<StarterProduct[]> {
  const [{ data: catalog }, prices] = await Promise.all([
    supabase
      .from("products")
      .select("id, sku, name, unit, category_id, sqft_per_unit")
      .eq("active", true)
      .in("category_id", ["ambit-foam", "spray-foam", "fiberglass"])
      .order("name"),
    ambitPrices(supabase, companyId),
  ]);
  const rows = (catalog ?? []) as CatalogRow[];
  const out: StarterProduct[] = [];

  // Spray foam: one set = 1 ISO drum + 1 drum of the resin.
  const isoSku = rows.find((r) => /^ISO$/i.test(r.sku))?.sku ?? "ISO";
  for (const r of rows.filter((x) => /^AMB-(SEAL|TITE|ROOF|JACK)/i.test(x.sku) && /^drums?$/i.test(x.unit))) {
    const line = FOAM_LINES.find((l) => l.re.test(r.sku))!;
    const resin = prices.sku[key(r.sku)];
    const iso = prices.iso[key(r.sku)];
    if (!line.always && !resin) continue;
    const cost = resin && iso ? Math.round((resin.price + iso.price) * 100) / 100 : null;
    const newer = resin && iso ? (Date.parse(resin.on) >= Date.parse(iso.on) ? resin : iso) : null;
    const season = /-W$/i.test(r.sku) || /\bwinter\b/i.test(r.name) ? "Winter" : /\bsummer\b/i.test(r.name) || rows.some((x) => x.sku.toUpperCase() === `${r.sku.toUpperCase()}-W`) ? "Summer" : null;
    const name = r.name.replace(/\s*\((summer|winter)\)/i, "").replace(/\s+Spray Foam\b/i, "").replace(/\s+Resin\b.*$/i, "").trim();
    out.push({
      product_id: r.id,
      ambit_skus: [isoSku, r.sku],
      kind: line.kind,
      name: `${name}${season ? ` ${season}` : ""} set (${line.label})`,
      sku: r.sku,
      unit: "set",
      cost,
      cost_source: cost !== null ? "ambit" : "manual",
      cost_note: newer ? note(newer) : "No AMBIT invoice price yet",
      yield_bf: line.kind === "foam_oc" ? YIELD_DEFAULTS.foam_oc : line.kind === "foam_cc" ? YIELD_DEFAULTS.foam_cc : null,
      lb_per_set: ISO_LB + resinLb(r.sku),
      r_value: null,
      sqft_per_unit: null,
      waste_pct: DEFAULT_SETTINGS.waste_pct,
      price_unit: "bf",
      active: true,
    });
  }

  // Fiberglass: blown products always; batts they've bought from AMBIT.
  for (const r of rows.filter((x) => x.category_id === "fiberglass")) {
    const last = prices.sku[key(r.sku)];
    const blown = isBlown(r.name);
    if (!blown && !last) continue;
    out.push({
      product_id: r.id,
      ambit_skus: [r.sku],
      kind: blown ? "blown" : "batt",
      name: r.name,
      sku: r.sku,
      unit: r.unit || "bag",
      cost: last ? last.price : null,
      cost_source: last ? "ambit" : "manual",
      cost_note: last ? note(last) : "No AMBIT invoice price yet",
      yield_bf: null,
      lb_per_set: null,
      r_value: blown ? null : rOf(r.name),
      sqft_per_unit: r.sqft_per_unit === null ? null : Number(r.sqft_per_unit),
      waste_pct: DEFAULT_SETTINGS.waste_pct,
      price_unit: "sqft",
      active: true,
    });
  }
  return out;
}
