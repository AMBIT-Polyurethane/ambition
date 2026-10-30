// AMBIT-OPS stock: what's in the shop and on each rig, and the stock check (what the scheduled work
// needs against what's on hand and on the way from AMBIT). Shared by the server pages.

import { isFoamKind, type QProduct } from "@/lib/ops/quote-calc";
import type { CatalogItem } from "@/lib/ops/materials";

export type StockRow = {
  id: string;
  place_kind: "location" | "rig";
  place_id: string;
  item_key: string;
  product_id: string | null;
  ops_product_id: string | null;
  name: string;
  unit: string;
  maker: string;
  lot_no: string;
  qty: number;
  updated_at: string;
};

export type Place = { kind: "location" | "rig"; id: string; name: string; color?: string | null };

export const STOCK_COLS = "id, place_kind, place_id, item_key, product_id, ops_product_id, name, unit, maker, lot_no, qty, updated_at";

/** Something that can be stocked: an AMBIT item (by SKU) or one of the contractor's own products. */
export type StockItem = { item_key: string; product_id: string | null; ops_product_id: string | null; name: string; unit: string; foam: "iso" | "resin" | null };

export const ISO_MAKERS = ["Covestro", "Wanhua", "Huntsman", "BASF", "Other"];

const unitOf = (u: string | null | undefined) => (u && u.trim() ? u.trim() : "each");

/** The things a contractor stocks: ISO and each resin for their foam sets, their fiberglass and supplies. */
export function stockItems(products: QProduct[], catalog: Map<string, CatalogItem>): StockItem[] {
  const out = new Map<string, StockItem>();
  const add = (i: StockItem) => { if (!out.has(i.item_key)) out.set(i.item_key, i); };
  const byId = new Map([...catalog.values()].map((c) => [c.id, c]));
  for (const p of products) {
    if (!p.active || ["labor", "other", "removal", "air_seal"].includes(p.kind)) continue;
    if (isFoamKind(p.kind)) {
      const [isoSku, resinSku] = p.ambit_skus.length >= 2 ? p.ambit_skus : ["ISO", p.sku ?? ""];
      const iso = catalog.get(isoSku.trim().toUpperCase());
      const resin = catalog.get((resinSku ?? "").trim().toUpperCase());
      if (iso) add({ item_key: iso.sku.trim().toUpperCase(), product_id: iso.id, ops_product_id: null, name: iso.name, unit: unitOf(iso.unit), foam: "iso" });
      if (resin) add({ item_key: resin.sku.trim().toUpperCase(), product_id: resin.id, ops_product_id: null, name: resin.name, unit: unitOf(resin.unit), foam: "resin" });
      if (!iso && !resin) add({ item_key: `OPS:${p.id}`.toUpperCase(), product_id: null, ops_product_id: p.id, name: p.name, unit: "set", foam: null });
      continue;
    }
    const c = (p.product_id ? byId.get(p.product_id) : null) ?? (p.sku ? catalog.get(p.sku.trim().toUpperCase()) : null) ?? null;
    if (c) add({ item_key: c.sku.trim().toUpperCase(), product_id: c.id, ops_product_id: null, name: c.name, unit: unitOf(c.unit), foam: null });
    else add({ item_key: `OPS:${p.id}`.toUpperCase(), product_id: null, ops_product_id: p.id, name: p.name, unit: unitOf(p.unit), foam: null });
  }
  return [...out.values()].sort((a, b) => (a.foam === b.foam ? a.name.localeCompare(b.name) : a.foam === "iso" ? -1 : b.foam === "iso" ? 1 : a.foam ? -1 : 1));
}

/** "Covestro · Lot PA86002836" */
export const lotText = (r: Pick<StockRow, "maker" | "lot_no">) => [r.maker || null, r.lot_no ? `Lot ${r.lot_no}` : "No lot #"].filter(Boolean).join(" · ");

export const qtyText = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Totals per item across the given rows. */
export function totals(rows: Pick<StockRow, "item_key" | "qty">[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.item_key, (m.get(r.item_key) ?? 0) + Number(r.qty));
  return m;
}

export type Incoming = { order_id: string; order_no: number; scheduled_for: string | null; status: string; item_key: string; product_id: string | null; name: string; qty: number };

export type CheckRow = {
  item_key: string;
  product_id: string | null;
  name: string;
  unit: string;
  need: number; // whole units (sets → drums, bags)
  exact: number;
  onRig: number;
  inShop: number;
  coming: number;
  short: number;
  why: string;
};
