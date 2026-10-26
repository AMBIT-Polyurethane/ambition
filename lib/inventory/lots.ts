// The FOAM LOTS tab: spray foam by brand and lot, laid out like the old inventory sheet.
// Starting Qty, Shipped In, Adj and the dates belong to the sheet; the app adds what's picked up to
// Shipped Out and fills in the formula columns (Remaining, Pending Pickup, Available, Product Total, Use By).
// Columns are found by their header text. Everything under the DAMAGED DRUMS band is left alone.

import { at, cellDate, cellNum, cellText, colLetter, findHeader, formulaAt, norm, sheetDate, type Grid } from "@/lib/inventory/sheet";

export const LOTS_TAB = "FOAM LOTS";

const LOT_COLS = {
  category: (h: string) => h === "category",
  label: (h: string) => h === "product" || h === "product description",
  sku: (h: string) => h === "sku",
  lot: (h: string) => h === "lot #" || h === "lot" || h === "lot number" || h === "lot no",
  mfg: (h: string) => h.startsWith("mfg"),
  exp: (h: string) => h.startsWith("exp"),
  starting: (h: string) => h.startsWith("starting"),
  out: (h: string) => h === "shipped out",
  in: (h: string) => h === "shipped in",
  adj: (h: string) => h === "adj" || h.startsWith("adjust"),
  remaining: (h: string) => h.startsWith("remaining"),
  pending: (h: string) => h.startsWith("pending"),
  available: (h: string) => h.startsWith("available"),
  total: (h: string) => h === "product total",
  useby: (h: string) => h === "use by",
  notes: (h: string) => h === "notes",
};
export type LotCol = keyof typeof LOT_COLS;
export const FORMULA_COLS: LotCol[] = ["remaining", "pending", "available", "total", "useby"];

export type LotRow = {
  row: number;
  label: string;
  sku: string;
  key: string; // SKU, upper case
  lot: string;
  lotKey: string; // lot, upper case
  mfg: string | null;
  exp: string | null;
  starting: number;
  out: number;
  in: number;
  adj: number;
  notes: string;
  /** Formula columns that are empty on this row (the sync fills them in). */
  missing: LotCol[];
};

export type LotsSheet = { headerRow: number; cols: Partial<Record<LotCol, number>>; rows: LotRow[]; last: number; dupes: string[] };

/** Rows 5..400 on a fresh tab; further down if the sheet has grown. */
export const lotRange = (s: Pick<LotsSheet, "headerRow" | "last">) => ({ first: s.headerRow + 1, last: Math.max(400, s.last + 100) });

export function parseLotsSheet(g: Grid): LotsSheet | null {
  const h = findHeader(g, LOT_COLS, ["sku", "lot", "starting", "out"]);
  if (!h) return null;
  const c = h.cols as Partial<Record<LotCol, number>>;
  const bottom = g.top + g.values.length - 1;
  const rows: LotRow[] = [];
  const seen = new Set<string>();
  const dupes: string[] = [];
  let last = h.row;
  for (let r = h.row + 1; r <= bottom; r++) {
    const first = norm(at(g, r, g.left)) || norm(at(g, r, c.category ?? g.left));
    if (first.startsWith("damaged")) break; // damaged drums: not stock
    const sku = cellText(at(g, r, c.sku!));
    if (!sku) continue; // bands, totals, blank rows
    last = r;
    const get = (k: LotCol) => (c[k] ? at(g, r, c[k]!) : undefined);
    const lot = cellText(get("lot"));
    const key = sku.toUpperCase();
    const dk = `${key}|${lot.toUpperCase()}`;
    if (seen.has(dk)) {
      dupes.push(`${sku} ${lot || "(no lot #)"}`);
      continue;
    }
    seen.add(dk);
    rows.push({
      row: r,
      label: cellText(get("label")),
      sku,
      key,
      lot,
      lotKey: lot.toUpperCase(),
      mfg: cellDate(get("mfg")),
      exp: cellDate(get("exp")),
      starting: cellNum(get("starting")) ?? 0,
      out: cellNum(get("out")) ?? 0,
      in: cellNum(get("in")) ?? 0,
      adj: cellNum(get("adj")) ?? 0,
      notes: cellText(get("notes")),
      missing: FORMULA_COLS.filter((k) => c[k] !== undefined && !formulaAt(g, r, c[k]!)),
    });
  }
  return { headerRow: h.row, cols: c, rows, last, dupes };
}

// ------------------------------------------------------------------ formulas
/** Where PENDING ORDERS keeps the qty, SKU, Notes and STATUS (for the Pending Pickup column). */
export type PendingRef = { tab: string; first: number; last: number; qty: number; sku: number; notes: number; status: number } | null;

const abs = (col: number, a: number, b: number) => `$${colLetter(col)}$${a}:$${colLetter(col)}$${b}`;
const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export function lotFormulas(cols: Partial<Record<LotCol, number>>, r: number, range: { first: number; last: number }, pend: PendingRef): Partial<Record<LotCol, string>> {
  const L = (k: LotCol) => (cols[k] ? colLetter(cols[k]!) : null);
  const out: Partial<Record<LotCol, string>> = {};
  const [G, H, I, J, K, Lp, C, D, E, F] = [L("starting"), L("out"), L("in"), L("adj"), L("remaining"), L("pending"), L("sku"), L("lot"), L("mfg"), L("exp")];
  if (K && G && H) out.remaining = `=N(${G}${r})-N(${H}${r})${I ? `+N(${I}${r})` : ""}${J ? `+N(${J}${r})` : ""}`;
  if (Lp && C && D && pend) {
    const P = (col: number) => `${q(pend.tab)}!${abs(col, pend.first, pend.last)}`;
    out.pending = `=SUMIFS(${P(pend.qty)},${P(pend.sku)},$${C}${r},${P(pend.notes)},"*[Lot "&IF($${D}${r}="","-",$${D}${r})&"]*",${P(pend.status)},"Pending Pickup")`;
  }
  if (L("available") && K) out.available = Lp ? `=N(${K}${r})-N(${Lp}${r})` : `=N(${K}${r})`;
  if (L("total") && K && C) {
    out.total = `=IF(COUNTIF($${C}$${range.first}:$${C}${r},$${C}${r})=1,SUMIFS(${abs(cols.remaining!, range.first, range.last)},${abs(cols.sku!, range.first, range.last)},$${C}${r}),"")`;
  }
  if (L("useby") && (E || F)) {
    const exp = F ? `$${F}${r}` : `""`;
    const mfg = E ? `$${E}${r}` : `""`;
    out.useby = `=IF(${exp}<>"",TEXT(${exp},"m/d/yyyy"),IF(${mfg}<>"",TEXT(EDATE(${mfg},12),"m/d/yyyy"),""))`;
  }
  return out;
}

/** COUNT SHEET TOTAL IN STOCK for a product counted by lot: everything left in its lots. */
export function countSheetTotal(tab: string, s: Pick<LotsSheet, "headerRow" | "last" | "cols">, skuCell: string): string | null {
  const { remaining, sku } = s.cols;
  if (!remaining || !sku) return null;
  const r = lotRange(s);
  return `=SUMIFS(${q(tab)}!${abs(remaining, r.first, r.last)},${q(tab)}!${abs(sku, r.first, r.last)},${skuCell})`;
}

// ------------------------------------------------------------------ a new tab
export type DbLot = {
  id: number;
  product_id: string;
  sku: string;
  lot_no: string;
  mfg: string | null;
  exp: string | null;
  use_by: string | null;
  starting: number;
  shipped_out: number;
  shipped_in: number;
  adj: number;
  out_unsynced: number;
  label: string | null;
  notes: string | null;
  sort: number;
};

type Group = { band: string; cat: string; total: string | null; match: (sku: string) => boolean; pattern: string | null; fill: string; font: string };
const GROUPS: Group[] = [
  { band: "ISO  (A-SIDE)", cat: "ISO", total: "Total ISO", match: (s) => /^ISO/i.test(s), pattern: "ISO-*", fill: "#E33527", font: "#FFFFFF" },
  { band: "OPEN CELL", cat: "OPEN CELL", total: "Total Open Cell", match: (s) => /^AMB-SEAL/i.test(s), pattern: "AMB-SEAL*", fill: "#18181B", font: "#FFFFFF" },
  { band: "CLOSED-CELL (HFO)", cat: "CLOSED-CELL (HFO)", total: "Total Closed-Cell", match: (s) => /^AMB-TITE/i.test(s), pattern: "AMB-TITE*", fill: "#A1A1AA", font: "#FFFFFF" },
  { band: "OTHER FOAM", cat: "OTHER", total: null, match: () => true, pattern: null, fill: "#D4D4D8", font: "#18181B" },
];

export const LOT_HEADERS = ["Category", "Product", "SKU", "Lot #", "Mfg Date", "Exp Date", "Starting Qty", "Shipped Out", "Shipped In", "Adj", "Remaining", "Pending Pickup", "Available", "Product Total", "Use By", "Notes"];
const WIDTH = LOT_HEADERS.length;
const HEADER_ROW = 4;

export type NewTab = {
  values: unknown[][];
  /** [address, part, body] */
  looks: [string, "" | "/font" | "/fill", Record<string, unknown>][];
};

/** The whole FOAM LOTS tab for a branch, from the app's copy of its lots. */
export function newLotsTab(place: string, lots: DbLot[], name: (l: DbLot) => string, pend: PendingRef): NewTab {
  const cols = Object.fromEntries(LOT_HEADERS.map((h, i) => [Object.keys(LOT_COLS).find((k) => LOT_COLS[k as LotCol](norm(h)))!, i + 1])) as Record<LotCol, number>;
  const range = { first: HEADER_ROW + 1, last: 400 };
  const last = colLetter(WIDTH);
  const blank = () => Array<unknown>(WIDTH).fill("");
  const values: unknown[][] = [
    [`${place}  ·  FOAM LOTS`, ...Array(WIDTH - 1).fill("")],
    ["Update the quantity on each lot daily. Starting Qty, Shipped In and Adj are yours; the app adds to Shipped Out when an order is picked up. New lot: add a row in its group with the SKU, Lot #, Mfg (and Exp) date and Starting Qty.", ...Array(WIDTH - 1).fill("")],
    ["Orders take ISO from Covestro first, then whichever lot expires soonest (no Exp date = 12 months after Mfg, shown under Use By). Resins: the lot that expires soonest. Expired lots are never picked automatically.", ...Array(WIDTH - 1).fill("")],
    [...LOT_HEADERS],
  ];
  const looks: NewTab["looks"] = [
    [`A1:${last}1`, "/font", { bold: true, size: 16 }],
    [`A2:${last}2`, "/fill", { color: "#FFF200" }],
    [`A2:${last}2`, "/font", { bold: true, color: "#C00000" }],
    [`A3:${last}3`, "/font", { italic: true, color: "#52525B" }],
    [`A${HEADER_ROW}:${last}${HEADER_ROW}`, "/fill", { color: "#D9D9D9" }],
    [`A${HEADER_ROW}:${last}${HEADER_ROW}`, "/font", { bold: true }],
    [`A${HEADER_ROW}:${last}${HEADER_ROW}`, "", { wrapText: true, verticalAlignment: "Bottom" }],
  ];

  const used = new Set<number>();
  for (const g of GROUPS) {
    const mine = lots.filter((l) => !used.has(l.id) && g.match(l.sku));
    if (!mine.length) continue;
    mine.forEach((l) => used.add(l.id));
    const bandRow = values.length + 1;
    values.push([g.band, ...Array(WIDTH - 1).fill("")]);
    looks.push([`A${bandRow}:${last}${bandRow}`, "/fill", { color: g.fill }], [`A${bandRow}:${last}${bandRow}`, "/font", { bold: true, color: g.font }]);
    for (const l of mine) {
      const r = values.length + 1;
      const f = lotFormulas(cols, r, range, pend);
      const row = blank();
      row[cols.category - 1] = g.cat;
      row[cols.label - 1] = l.label || name(l);
      row[cols.sku - 1] = l.sku;
      row[cols.lot - 1] = l.lot_no ? `'${l.lot_no}` : "";
      row[cols.mfg - 1] = l.mfg ? sheetDate(l.mfg) : "";
      row[cols.exp - 1] = l.exp ? sheetDate(l.exp) : "";
      row[cols.starting - 1] = Number(l.starting);
      row[cols.out - 1] = Number(l.shipped_out) + Number(l.out_unsynced);
      row[cols.in - 1] = Number(l.shipped_in) || "";
      row[cols.adj - 1] = Number(l.adj) || "";
      for (const k of FORMULA_COLS) if (f[k]) row[cols[k] - 1] = f[k];
      row[cols.notes - 1] = l.notes ?? "";
      values.push(row);
    }
    if (g.total && g.pattern) {
      const r = values.length + 1;
      const row = blank();
      row[cols.label - 1] = g.total;
      for (const k of ["remaining", "pending", "available"] as LotCol[]) {
        row[cols[k] - 1] = `=SUMIFS(${abs(cols[k], range.first, range.last)},${abs(cols.sku, range.first, range.last)},"${g.pattern}")`;
      }
      values.push(row);
      looks.push([`A${r}:${last}${r}`, "/fill", { color: "#F4D6D6" }], [`A${r}:${last}${r}`, "/font", { bold: true }]);
    }
    values.push(blank());
  }

  const dmg = values.length + 1;
  values.push(["DAMAGED DRUMS  (not for sale, not counted in stock: take them off their lot with Adj)", ...Array(WIDTH - 1).fill("")]);
  const head = blank();
  head[cols.label - 1] = "Product";
  head[cols.sku - 1] = "SKU";
  head[cols.lot - 1] = "Lot #";
  head[cols.starting - 1] = "Qty";
  head[cols.notes - 1] = "What happened";
  values.push(head, blank(), blank(), blank());
  looks.push(
    [`A${dmg}:${last}${dmg}`, "/fill", { color: "#FEF3C7" }],
    [`A${dmg}:${last}${dmg}`, "/font", { bold: true }],
    [`A${dmg + 1}:${last}${dmg + 1}`, "/font", { bold: true, color: "#52525B" }],
    ["A:A", "", { columnWidth: 105 }],
    ["B:B", "", { columnWidth: 185 }],
    ["C:D", "", { columnWidth: 100 }],
    ["E:F", "", { columnWidth: 72 }],
    ["G:N", "", { columnWidth: 66 }],
    ["O:O", "", { columnWidth: 72 }],
    ["P:P", "", { columnWidth: 260 }],
  );
  return { values, looks };
}
