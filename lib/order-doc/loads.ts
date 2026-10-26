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

type Lineish = { sku: string; name: string; qty: number | string; unit: string; foam?: FoamSide };

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
};
export type LoadGroup<T> = { kind: "load" | "iso" | "other"; rows: LoadRow<T>[] };

/**
 * The order's lines in groups. Without both ISO and a resin there's one plain group (nothing changes).
 * Otherwise: one group per resin with its share of ISO, then any ISO left over, then everything else.
 */
export function foamLoads<T extends Lineish>(items: T[]): LoadGroup<T>[] {
  const iso = items.filter((i) => foamSide(i) === "iso");
  const resin = items.filter((i) => foamSide(i) === "resin");
  if (!iso.length || !resin.length) return [{ kind: "other", rows: items.map((item) => ({ item, qty: Number(item.qty) })) }];

  const pool = iso.map((item) => ({ item, total: Number(item.qty), left: Number(item.qty) }));
  const groups: LoadGroup<T>[] = [];
  for (const r of resin) {
    let need = Number(r.qty);
    const rows: LoadRow<T>[] = [];
    for (const p of pool) {
      if (need <= 0) break;
      if (p.left <= 0) continue;
      const take = Math.min(need, p.left);
      rows.push({ item: p.item, qty: take, of: take < p.total ? p.total : undefined, with: r.name });
      p.left -= take;
      need -= take;
    }
    rows.push({ item: r, qty: Number(r.qty) });
    groups.push({ kind: "load", rows });
  }
  // One resin: no need to say which resin the ISO goes with.
  if (groups.length === 1) for (const row of groups[0].rows) delete row.with;
  const leftover = pool.filter((p) => p.left > 0);
  if (leftover.length) {
    groups.push({ kind: "iso", rows: leftover.map((p) => ({ item: p.item, qty: p.left, of: p.left < p.total ? p.total : undefined, extra: true })) });
  }
  const other = items.filter((i) => !foamSide(i));
  if (other.length) groups.push({ kind: "other", rows: other.map((item) => ({ item, qty: Number(item.qty) })) });
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

const fmt = (n: number) => (n % 1 === 0 ? n.toFixed(0) : String(n));
const shortName = (n: string) => n.replace(/\s+(Spray Foam|Resin.*)$/i, "").trim();
