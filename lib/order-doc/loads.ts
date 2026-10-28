// Spray foam on the order form: each resin (B side) is paired with the ISO (A side) drums that go with it,
// so a mixed load reads the way the warehouse loads it. 6 ISO + 4 AMBI-SEAL 5.0 + 2 AMBI-TITE 204 prints as
//   ISO 4 drums / AMBI-SEAL 5.0 4 drums   ──────   ISO 2 drums / AMBI-TITE 204 2 drums
// with a dark line between the groups. Works for any number of resins and more than one ISO brand.

export type FoamSide = "iso" | "resin" | null;

/** AMBIT's spray foam category: ISO (A side) and the resins (B side), all by the drum. */
export function foamOf(i: { sku: string; unit: string }, category: string | null | undefined): FoamSide | undefined {
  if (category !== "ambit-foam") return undefined; // not known here: the SKU and name decide (foamSide)
  if (!/^drums?$/i.test(i.unit)) return null;
  return /^ISO/i.test(i.sku) ? "iso" : "resin";
}

/** Where the warehouse takes a line's drums from (AMBIT staff only): brand SKU and lot. */
export type LotPick = { id: number; qty: number; sku: string; lot_id: number | null; lot_no: string | null; exp: string | null; use_by: string | null; state: string };

type Lineish = { id?: number; sku: string; name: string; qty: number | string; unit: string; foam?: FoamSide; picks?: LotPick[] };

/** ISO (A side) or resin (B side)? Uses the product's category when the loader knew it, else the SKU and name. */
export function foamSide(it: Lineish): FoamSide {
  if (it.foam !== undefined) return it.foam;
  const sku = (it.sku ?? "").toUpperCase();
  const name = it.name ?? "";
  if (/^ISO\b|^ISO-/.test(sku) || /\bpMDI\b|\bISO\b.*A-?Side/i.test(name)) return "iso";
  if (/^AMB-(SEAL|TITE|JACK|ROOF)\b/.test(sku) || /\bResin\s*\(B-?Side\)/i.test(name)) return "resin";
  return null;
}

export type LoadRow<T> = {
  item: T;
  qty: number;
  /** For an ISO line split across loads: its full quantity on the order, and the resin it's paired with. */
  of?: number;
  with?: string;
  /** ISO left over after every resin has its drums. */
  extra?: boolean;
  /** An ISO row in a mixed load: the order item id of the resin it goes with (null for leftover ISO). */
  pair?: number | null;
  /** The lots this row's drums come from (staff copies only). */
  picks?: LotPick[];
};
export type LoadGroup<T> = { kind: "load" | "iso" | "other"; rows: LoadRow<T>[] };

/**
 * The order's lines in groups. Without both ISO and a resin there's one plain group (nothing changes).
 * Otherwise: one group per resin with its share of ISO, then any ISO left over, then everything else.
 */
export function foamLoads<T extends Lineish>(items: T[]): LoadGroup<T>[] {
  const iso = items.filter((i) => foamSide(i) === "iso");
  const resin = items.filter((i) => foamSide(i) === "resin");
  if (!iso.length || !resin.length) return [{ kind: "other", rows: items.map((item) => ({ item, qty: Number(item.qty), picks: item.picks })) }];

  const pool = iso.map((item) => ({ item, total: Number(item.qty), left: Number(item.qty), queue: (item.picks ?? []).map((p) => ({ ...p })) }));
  // The first n drums still in a line's lots (in pick order).
  const takePicks = (queue: LotPick[], n: number): LotPick[] | undefined => {
    if (!queue.length) return undefined;
    const out: LotPick[] = [];
    while (n > 0.0001 && queue.length) {
      const p = queue[0];
      const t = Math.min(n, p.qty);
      out.push({ ...p, qty: t });
      p.qty -= t;
      n -= t;
      if (p.qty <= 0.0001) queue.shift();
    }
    return out;
  };
  const groups: LoadGroup<T>[] = [];
  for (const r of resin) {
    let need = Number(r.qty);
    const rows: LoadRow<T>[] = [];
    for (const p of pool) {
      if (need <= 0) break;
      if (p.left <= 0) continue;
      const take = Math.min(need, p.left);
      rows.push({ item: p.item, qty: take, of: take < p.total ? p.total : undefined, with: r.name, pair: r.id ?? null, picks: takePicks(p.queue, take) });
      p.left -= take;
      need -= take;
    }
    rows.push({ item: r, qty: Number(r.qty), picks: r.picks });
    groups.push({ kind: "load", rows });
  }
  // One resin: no need to say which resin the ISO goes with.
  if (groups.length === 1) for (const row of groups[0].rows) delete row.with;
  const leftover = pool.filter((p) => p.left > 0);
  if (leftover.length) {
    groups.push({ kind: "iso", rows: leftover.map((p) => ({ item: p.item, qty: p.left, of: p.left < p.total ? p.total : undefined, extra: true, pair: null, picks: takePicks(p.queue, p.left) })) });
  }
  const other = items.filter((i) => !foamSide(i));
  if (other.length) groups.push({ kind: "other", rows: other.map((item) => ({ item, qty: Number(item.qty), picks: item.picks })) });
  return groups;
}

/** The small note under a split ISO line: "2 of 6 ISO drums, with AMBI-TITE 204 HFO". */
export function splitNote(row: { qty: number; of?: number; with?: string; extra?: boolean }, unitPlural: string): string | null {
  if (!row.of && !row.with && !row.extra) return null;
  const parts = [
    row.of ? `${fmt(row.qty)} of ${fmt(row.of)} ${unitPlural} on this order` : null,
    row.with ? `with ${shortName(row.with)}` : null,
    row.extra ? "extra ISO, not paired with a resin" : null,
  ];
  return parts.filter(Boolean).join(", ");
}

// ------------------------------------------------------------------ prices
// AMBIT prices spray foam by the set: the ISO (A side) going with a closed-cell resin can cost more than the
// ISO going with an open-cell resin on the same order. So an ISO line split across foam sets gets one price
// per set (0030), kept on the line as price_parts; its unit_price is the average and line_total the sum.

/** One foam set's ISO price. with = the resin's order item id; null for leftover ISO not paired with a resin. */
export type PricePart = { with: number | null; qty: number; price: number };

type Priceish = { qty: number | string; unit_price: number | string | null; line_total: number | string | null; price_parts?: PricePart[] | null };

const cents = (n: number) => Math.round(n * 100) / 100;

/** The price each and the amount for one row of the order (a whole line, or an ISO line's share of one foam set). */
export function rowPrice(it: Priceish, row: { qty: number; pair?: number | null }): { each: number | null; total: number | null } {
  if (it.line_total === null || it.line_total === undefined) return { each: it.unit_price === null ? null : Number(it.unit_price), total: null };
  const part = row.pair !== undefined ? it.price_parts?.find((p) => (p.with ?? null) === row.pair && Number(p.qty) === row.qty) : undefined;
  if (part) return { each: Number(part.price), total: cents(Number(part.price) * row.qty) };
  const each = it.unit_price === null ? null : Number(it.unit_price);
  return { each, total: row.qty === Number(it.qty) ? Number(it.line_total) : cents((each ?? 0) * row.qty) };
}

/** One price box on the order desk. An ISO line split across foam sets gets one box per set. */
export type PriceLine = {
  /** "12" for a whole line; "12:34" for ISO line 12's drums going with resin line 34; "12:x" for its leftover ISO. */
  key: string;
  id: number;
  sku: string;
  name: string;
  unit: string;
  /** The quantity this box prices (the set's share of a split ISO line). */
  qty: number;
  /** A split ISO line: its full quantity, the resin line it goes with (null = not paired) and that resin's name. */
  of?: number;
  with?: number | null;
  withName?: string;
  price: number | null;
  cp: boolean;
};

type PriceItem = Lineish & Priceish & { id: number; customer_priced: boolean };

/**
 * The order desk's price boxes, in the order the loads print (ISO for a set, then its resin, like the invoice).
 * An ISO line that goes with more than one resin (or has drums left over) is split into one box per set.
 */
export function priceLines(items: PriceItem[]): PriceLine[] {
  const groups = foamLoads(items);
  const rowsOf = new Map<number, number>();
  for (const g of groups) for (const r of g.rows) rowsOf.set(r.item.id, (rowsOf.get(r.item.id) ?? 0) + 1);
  const names = new Map(items.map((i) => [i.id, i.name]));
  const out: PriceLine[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      const it = r.item;
      const base = { id: it.id, sku: it.sku, name: it.name, unit: it.unit, cp: it.customer_priced };
      const unit = it.unit_price === null ? null : Number(it.unit_price);
      if ((rowsOf.get(it.id) ?? 0) > 1 && r.pair !== undefined) {
        const pair = r.pair ?? null;
        const part = it.price_parts?.find((p) => (p.with ?? null) === pair);
        out.push({
          ...base,
          key: `${it.id}:${pair ?? "x"}`,
          qty: r.qty,
          of: Number(it.qty),
          with: pair,
          withName: pair === null ? undefined : shortName(names.get(pair) ?? ""),
          price: part ? Number(part.price) : unit,
        });
      } else {
        out.push({ ...base, key: String(it.id), qty: Number(it.qty), price: unit });
      }
    }
  }
  return out;
}

const fmt = (n: number) => (n % 1 === 0 ? n.toFixed(0) : String(n));
const shortName = (n: string) => n.replace(/\s+(Spray Foam|Resin.*)$/i, "").trim();

// ------------------------------------------------------------------ lots (staff only)
const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`;

/** "Covestro" for ISO-COVESTRO; nothing for a resin (the line already names it). */
export function brandOf(sku: string): string | null {
  const m = /^ISO-(.+)$/i.exec(sku.trim());
  return m ? m[1].toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : null;
}

/** "Covestro · Lot PA86002836 · exp 4/2/27" */
export function pickText(p: LotPick): string {
  const lot = p.lot_no ? `Lot ${p.lot_no}` : p.state === "reserved" ? "no lot picked yet (short on stock)" : "no lot";
  const date = p.exp ? `exp ${shortDate(p.exp)}` : p.use_by ? `use by ${shortDate(p.use_by)}` : null;
  return [brandOf(p.sku), lot, p.lot_no ? date : null].filter(Boolean).join(" · ");
}
