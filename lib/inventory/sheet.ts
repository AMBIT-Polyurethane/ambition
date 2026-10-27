// Reading the branch inventory workbook (pure functions, no Microsoft calls).
// Columns are found by their header text, so inserting or moving a column on the sheet is fine.
// Formula columns (PENDING PICKUP, NET AVAILABLE, Line Total, ...) are never written.

export type Grid = {
  top: number; // sheet row of values[0] (1 = row 1)
  left: number; // sheet column of values[0][0] (1 = A)
  values: unknown[][];
  formulas: unknown[][];
};

export const STATUS = { pending: "Pending Pickup", done: "Picked Up / Completed", cancelled: "Cancelled" } as const;
export type StatusKind = keyof typeof STATUS | "other" | "";

export const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const skuKey = (v: unknown) => cellText(v).toUpperCase();

/** A cell as text (whole numbers without ".0"). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

export function cellNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[,$\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Excel date (serial number or typed text) as YYYY-MM-DD. */
export function cellDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(t);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return null;
}

/** YYYY-MM-DD as the sheet shows dates: 10/25/2026. */
export const sheetDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** "'COUNT SHEET'!A1:AA291" -> top-left cell. */
export function rangeStart(address: string): { top: number; left: number } {
  const cell = address.split("!").pop()!.split(":")[0].replace(/\$/g, "");
  const m = /^([A-Z]+)(\d+)$/i.exec(cell);
  return m ? { top: Number(m[2]), left: colNumber(m[1]) } : { top: 1, left: 1 };
}

export const at = (g: Grid, row: number, col: number) => g.values[row - g.top]?.[col - g.left];
export const formulaText = (g: Grid, row: number, col: number): string | null => {
  const f = g.formulas[row - g.top]?.[col - g.left];
  return typeof f === "string" && f.startsWith("=") ? f : null;
};

/**
 * A formula moved to another row, the way Excel's copy / fill does it: row numbers without a $ move by `delta`,
 * $-anchored rows stay. Text in "quotes" and 'sheet names' are left alone.
 */
export function shiftFormula(f: string, delta: number): string {
  if (!delta) return f;
  return f
    .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(?<![A-Za-z0-9_.$])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, col: string, abs: string, row: string) =>
            abs ? m : `${col}${Number(row) + delta}`,
          ),
    )
    .join("");
}
export const formulaAt = (g: Grid, row: number, col: number) => {
  const f = g.formulas[row - g.top]?.[col - g.left];
  return typeof f === "string" && f.startsWith("=");
};

type ColSpec = Record<string, (h: string) => boolean>;

/** Finds the header row (the first row that has every required column) and where each column is. */
export function findHeader<K extends string>(g: Grid, spec: Record<K, (h: string) => boolean>, required: K[]) {
  const last = Math.min(g.top + g.values.length - 1, g.top + 40);
  for (let r = g.top; r <= last; r++) {
    const cols = {} as Record<K, number>;
    const row = g.values[r - g.top] ?? [];
    row.forEach((v, i) => {
      const h = norm(v);
      if (!h) return;
      for (const k of Object.keys(spec) as K[]) {
        if (cols[k] === undefined && (spec as ColSpec)[k](h)) {
          cols[k] = g.left + i;
          break;
        }
      }
    });
    if (required.every((k) => cols[k] !== undefined)) return { row: r, cols };
  }
  return null;
}

// ------------------------------------------------------------------ COUNT SHEET
const COUNT_COLS = {
  sku: (h: string) => h === "sku",
  desc: (h: string) => h === "description",
  group: (h: string) => h === "group",
  uom: (h: string) => h === "uom",
  weight: (h: string) => h.startsWith("unit weight"),
  price: (h: string) => h === "sell price",
  stock: (h: string) => h === "total in stock",
  pending: (h: string) => h === "pending pickup",
  net: (h: string) => h === "net available",
  rop: (h: string) => h === "reorder point",
  max: (h: string) => h === "max",
  counted: (h: string) => h === "last counted",
  by: (h: string) => h === "counted by",
  notes: (h: string) => h === "notes",
};
export type CountCol = keyof typeof COUNT_COLS;

export type SheetItem = {
  row: number;
  sku: string;
  skuRaw: unknown; // as stored on the sheet (number or text), copied as-is into PENDING ORDERS
  key: string;
  desc: string;
  group: string;
  uom: string;
  weight: number | null;
  price: number | null;
  stock: number | null;
  rop: number | null;
  max: number | null;
  counted: string | null;
  countedBy: string;
};

export type CountSheet = { headerRow: number; cols: Partial<Record<CountCol, number>>; items: SheetItem[]; duplicates: string[] };

export function parseCountSheet(g: Grid): CountSheet {
  const h = findHeader(g, COUNT_COLS, ["sku", "desc", "stock"]);
  if (!h) throw new Error("COUNT SHEET has no header row with SKU, Description and TOTAL IN STOCK.");
  const c = h.cols as Partial<Record<CountCol, number>>;
  const items: SheetItem[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const bottom = g.top + g.values.length - 1;
  for (let r = h.row + 1; r <= bottom; r++) {
    const skuRaw = at(g, r, c.sku!);
    const sku = cellText(skuRaw);
    const desc = cellText(at(g, r, c.desc!));
    if (!sku || !desc) continue; // group bands, blank rows
    const key = sku.toUpperCase();
    if (seen.has(key)) {
      duplicates.push(sku);
      continue;
    }
    seen.add(key);
    const get = (k: CountCol) => (c[k] ? at(g, r, c[k]!) : undefined);
    items.push({
      row: r,
      sku,
      skuRaw,
      key,
      desc,
      group: cellText(get("group")),
      uom: cellText(get("uom")),
      weight: cellNum(get("weight")),
      price: cellNum(get("price")),
      stock: cellNum(get("stock")),
      rop: cellNum(get("rop")),
      max: cellNum(get("max")),
      counted: cellDate(get("counted")),
      countedBy: cellText(get("by")),
    });
  }
  return { headerRow: h.row, cols: c, items, duplicates };
}

// ------------------------------------------------------------------ PENDING ORDERS
const PENDING_COLS = {
  order: (h: string) => h === "order #" || h === "order",
  date: (h: string) => h === "date",
  customer: (h: string) => h.startsWith("customer"),
  sku: (h: string) => h === "sku",
  desc: (h: string) => h === "description",
  uom: (h: string) => h === "uom",
  qty: (h: string) => h === "qty" || h === "quantity",
  price: (h: string) => h === "unit price",
  total: (h: string) => h === "line total",
  weight: (h: string) => h.startsWith("line wt") || h.startsWith("line weight"),
  status: (h: string) => h === "status",
  po: (h: string) => h === "po #" || h === "po",
  closed: (h: string) => h.startsWith("closed"),
  notes: (h: string) => h === "notes",
};
export type PendingCol = keyof typeof PENDING_COLS;
const ROW_FIELDS: PendingCol[] = ["order", "date", "customer", "sku", "desc", "uom", "qty", "price", "weight", "status", "po", "closed", "notes"];

export type PendingRow = {
  row: number;
  order: string;
  date: string | null;
  customer: string;
  sku: string;
  key: string;
  qty: number | null;
  status: string;
  kind: StatusKind;
  po: string;
  closed: string | null;
  notes: string;
  /** Line Wt (lbs), when it's filled in. */
  weight: number | null;
  /** The lot in the Notes ("[Lot PA86002836]"), "" for "[Lot -]", null when there's none. */
  lot: string | null;
};

export type PendingSheet = {
  headerRow: number;
  cols: Partial<Record<PendingCol, number>>;
  rows: PendingRow[];
  /** Empty rows inside the table (between the header and the last row with the line formulas). */
  free: number[];
  /** Columns the app may write: known columns that don't hold formulas. */
  writable: PendingCol[];
  /** Last row of the table (where the line formulas stop). */
  end: number;
};

export function statusKind(v: unknown): StatusKind {
  const s = norm(v);
  if (!s) return "";
  if (s.startsWith("pending")) return "pending";
  if (s.startsWith("picked up") || s.includes("completed") || s === "delivered") return "done";
  if (s.startsWith("cancel")) return "cancelled";
  return "other";
}

export function parsePendingSheet(g: Grid): PendingSheet {
  const h = findHeader(g, PENDING_COLS, ["order", "sku", "qty", "status"]);
  if (!h) throw new Error("PENDING ORDERS has no header row with Order #, SKU, Qty and STATUS.");
  const c = h.cols as Partial<Record<PendingCol, number>>;
  const bottom = g.top + g.values.length - 1;
  const known = (Object.keys(c) as PendingCol[]).filter((k) => c[k] !== undefined);

  // A column is off limits if any row below the header has a formula in it.
  const formulaCols = new Set<PendingCol>();
  for (const k of known) {
    for (let r = h.row + 1; r <= bottom; r++) {
      if (formulaAt(g, r, c[k]!)) {
        formulaCols.add(k);
        break;
      }
    }
  }
  // The table ends at the last row that still has the line formulas (the reserved-stock totals stop there).
  let end = bottom;
  const fcol = [...formulaCols].map((k) => c[k]!)[0];
  if (fcol) {
    for (let r = bottom; r > h.row; r--) {
      if (formulaAt(g, r, fcol)) {
        end = r;
        break;
      }
    }
  }

  const rows: PendingRow[] = [];
  const free: number[] = [];
  for (let r = h.row + 1; r <= end; r++) {
    const get = (k: PendingCol) => (c[k] ? at(g, r, c[k]!) : undefined);
    const empty = ROW_FIELDS.filter((k) => c[k] && !formulaCols.has(k)).every((k) => cellText(get(k)) === "");
    if (empty) {
      free.push(r);
      continue;
    }
    const sku = cellText(get("sku"));
    rows.push({
      row: r,
      order: cellText(get("order")),
      date: cellDate(get("date")),
      customer: cellText(get("customer")),
      sku,
      key: sku.toUpperCase(),
      qty: cellNum(get("qty")),
      status: cellText(get("status")),
      kind: statusKind(get("status")),
      po: cellText(get("po")),
      closed: cellDate(get("closed")),
      notes: cellText(get("notes")),
      weight: cellNum(get("weight")),
      lot: lotInNotes(cellText(get("notes"))),
    });
  }
  return { headerRow: h.row, cols: c, rows, free, writable: known.filter((k) => !formulaCols.has(k)), end };
}

// Spray foam lines name their lot in the Notes, so FOAM LOTS can add up what each lot has waiting.
const LOT_TAG = /\[Lot ([^\]]*)\]/i;
const NO_LOT_TAG = /\s*\[No lot picked yet\]/gi;
export const lotTag = (lot: string | null | undefined) => (lot === null || lot === undefined ? "[No lot picked yet]" : `[Lot ${lot.trim() || "-"}]`);
export function lotInNotes(notes: string): string | null {
  const m = LOT_TAG.exec(notes);
  if (!m) return null;
  const v = m[1].trim();
  return v === "-" ? "" : v;
}
/** The Notes with this lot's tag (any other lot tag replaced). */
export function withLotTag(notes: string, lot: string | null | undefined): string {
  const rest = notes.replace(/\s*\[Lot [^\]]*\]/gi, "").replace(NO_LOT_TAG, "").trim();
  return `${rest ? `${rest} · ` : ""}${lotTag(lot)}`.replace(/ · · /g, " · ");
}

/** Lines typed straight into PENDING ORDERS are recognised again by what's in them. */
export function fingerprint(r: PendingRow): string {
  return [norm(r.order), r.date ?? "", norm(r.customer), r.key, r.qty ?? ""].join("|");
}

export const STOCK_MARK = /\[stock taken/i;
export const stockMark = (isoDay: string) => `[Stock taken ${isoDay.slice(5, 7)}/${isoDay.slice(8, 10)} by AMBIT A.I.]`;

/** Contiguous runs of columns, skipping the ones that must not be written. */
export function runs(cols: number[]): number[][] {
  const sorted = [...new Set(cols)].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === n - 1) last.push(n);
    else out.push([n]);
  }
  return out;
}

/** Group bands and the like: "GUNS & PARTS" -> guns-and-parts (the app's category ids). */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, "and")
    .replace(/\bPpe\b/g, "PPE");

/** The sheet's UOM as the app's unit word. */
export function unitFromUom(uom: string): string {
  const u = uom.trim().toLowerCase();
  if (!u || u === "ea" || u === "each") return "each";
  const map: Record<string, string> = { gal: "gallon", pr: "pair", bx: "box", cs: "case", rl: "roll", pk: "pack", bg: "bag", pl: "pail", dr: "drum", bdl: "bundle" };
  return map[u] ?? u;
}
