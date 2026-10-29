// "Create Material Order": what a quote or a takeoff needs from AMBIT. Foam: whole sets, so an ISO
// drum and a resin drum per set. Blown and batts: whole bags. Supplies: what's on the quote.

import { isFoamKind, type QLine, type QProduct } from "@/lib/ops/quote-calc";

export type CatalogItem = { id: string; sku: string; name: string; unit: string };

export type NeedRow = {
  key: string;
  product_id: string; // AMBIT catalog id (what goes in the order)
  sku: string;
  name: string;
  unit: string;
  exact: number; // what the work needs (sets, bags, each), before rounding
  qty: number; // whole units to order
  why: string; // e.g. "1.45 sets of AMBI-SEAL 5.0 Summer set (open cell)"
};

export type Needs = { rows: NeedRow[]; elsewhere: { name: string; exact: number; unit: string }[]; missing: string[] };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function materialNeeds(lines: QLine[], products: Map<string, QProduct>, catalog: Map<string, CatalogItem>): Needs {
  const bySku = (sku: string | null | undefined) => (sku ? catalog.get(sku.trim().toUpperCase()) ?? null : null);
  const tally = new Map<string, { p: QProduct; units: number }>();
  for (const l of lines) {
    if (!l.product_id || !l.units) continue;
    const p = products.get(l.product_id);
    if (!p) continue;
    const t = tally.get(p.id) ?? { p, units: 0 };
    t.units += Number(l.units) || 0;
    tally.set(p.id, t);
  }
  const rows = new Map<string, NeedRow>();
  const elsewhere: Needs["elsewhere"] = [];
  const missing: string[] = [];
  const add = (item: CatalogItem, exact: number, qty: number, why: string) => {
    const cur = rows.get(item.id);
    if (cur) {
      cur.exact = r2(cur.exact + exact);
      cur.qty += qty;
      cur.why += `; ${why}`;
    } else rows.set(item.id, { key: item.id, product_id: item.id, sku: item.sku, name: item.name, unit: item.unit, exact: r2(exact), qty, why });
  };
  for (const { p, units } of tally.values()) {
    if (isFoamKind(p.kind)) {
      // A set is an ISO drum plus a drum of the resin; order whole sets.
      const sets = Math.ceil(units - 1e-9);
      const [isoSku, resinSku] = p.ambit_skus.length >= 2 ? p.ambit_skus : ["ISO", p.sku ?? ""];
      const iso = bySku(isoSku);
      const resin = bySku(resinSku);
      if (!resin) {
        if (p.product_id || p.ambit_skus.length) missing.push(p.name);
        else elsewhere.push({ name: p.name, exact: r2(units), unit: "set" });
        continue;
      }
      const why = `${r2(units)} set${r2(units) === 1 ? "" : "s"} of ${p.name}`;
      add(resin, units, sets, why);
      if (iso) add(iso, units, sets, why);
      else missing.push(`ISO for ${p.name}`);
      continue;
    }
    const item = p.product_id ? [...catalog.values()].find((c) => c.id === p.product_id) ?? bySku(p.sku) : bySku(p.sku);
    if (!item) {
      elsewhere.push({ name: p.name, exact: r2(units), unit: p.unit });
      continue;
    }
    add(item, units, Math.ceil(units - 1e-9), `${r2(units)} ${p.unit}${r2(units) === 1 ? "" : "s"} for ${p.name}`);
  }
  return { rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)), elsewhere, missing: [...new Set(missing)] };
}
