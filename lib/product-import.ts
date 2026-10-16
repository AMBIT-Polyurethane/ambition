// Turns spreadsheet rows into products. Accepts the app's own template and the
// AMBIT Inventory Control Workbook "Item Master" tab saved as CSV.
// Cost, margin and vendor columns are never read.

export type ProductRow = {
  sku: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  unit: string;
  unitInferred: boolean;
  list_price: number | null;
  customer_priced: boolean | null; // null = follow the category
  active: boolean;
  sort: number;
};

// Categories that show "Based on customer pricing" when first created.
export const CUSTOMER_PRICED_CATEGORIES = ["ambit foam", "spray foam", "fiberglass", "fiberglass insulation", "fibreglass"];

const UOM: Record<string, string> = {
  ea: "each", each: "each", pc: "each", pcs: "each",
  bag: "bag", bg: "bag",
  box: "box", bx: "box",
  roll: "roll", rl: "roll",
  pack: "pack", pk: "pack",
  set: "set",
  can: "can",
  tube: "tube",
  bundle: "bundle", bdl: "bundle",
  pair: "pair", pr: "pair",
  case: "case", cs: "case",
  pail: "pail",
  drum: "drum",
  gal: "gallon", gallon: "gallon",
  kit: "kit",
  pallet: "pallet",
  sheet: "sheet",
};

export function normalizeHeader(h: string): string {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function money(v: unknown): number | null {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  if (t === "" || t.toLowerCase() === "n/a") return null;
  const x = Number(t);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

const yes = (v: unknown) => /^(y|yes|true|1|x|on)$/i.test(String(v ?? "").trim());

export function unitFor(rawUnit: string, name: string, category = ""): { unit: string; inferred: boolean } {
  const u = rawUnit.trim().toLowerCase();
  if (u && u !== "n/a" && u !== "none") return { unit: UOM[u] ?? u, inferred: false };
  const n = name.toLowerCase();
  const gal = /\b(\d+(?:\.\d+)?)[- ]?(?:gal|gallon)s?\b/.exec(n);
  if (/\bdrum\b/.test(n) || (gal && Number(gal[1]) >= 15)) return { unit: "drum", inferred: true };
  if (/\bpails?\b/.test(n) || (gal && Number(gal[1]) === 5) || /\b5g\b/.test(n)) return { unit: "pail", inferred: true };
  if ((gal && Number(gal[1]) === 1) || /\bjug\b/.test(n)) return { unit: "gallon", inferred: true };
  if (/\bkit\b/.test(n)) return { unit: "kit", inferred: true };
  if (/\broll\b|\btape\b/.test(n)) return { unit: "roll", inferred: true };
  if (/\bbox\b|\/box\b/.test(n)) return { unit: "box", inferred: true };
  if (/\bcan\b|\baerosol\b/.test(n)) return { unit: "can", inferred: true };
  if (/fiberglass/i.test(category)) return { unit: "bag", inferred: true };
  return { unit: "each", inferred: true };
}

function activeFrom(r: Record<string, string>): boolean {
  if ((r.active ?? "").trim()) return yes(r.active);
  const status = (r.status ?? "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "manufactured" || status === "stocked";
}

export function normalizeProductRows(rows: Record<string, string>[]): { products: ProductRow[]; problems: string[] } {
  const products: ProductRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  // The Item Master has no "name" column: its "Description" is the product name.
  const hasName = rows.some((r) => (r.name ?? "").trim() !== "");

  rows.forEach((r, i) => {
    const sku = String(r.sku ?? r.item ?? r["item_#"] ?? r["part_#"] ?? "").trim();
    const name = String((hasName ? r.name : r.description) ?? r.product ?? "").replace(/\s+/g, " ").trim();
    if (!sku && !name) return;
    if (!sku || !name) {
      if (sku || name) problems.push(`${sku || name}: needs both a SKU and a name`);
      return;
    }
    const key = sku.toLowerCase();
    if (seen.has(key)) {
      problems.push(`${sku}: listed twice, kept the first`);
      return;
    }
    seen.add(key);

    const categoryName = String(r.group ?? r.category ?? "").trim() || null;
    const { unit, inferred } = unitFor(String(r.unit ?? r.uom ?? ""), name, categoryName ?? "");
    const cpRaw = String(r.customer_priced ?? r.customer_pricing ?? "").trim();
    products.push({
      sku,
      name,
      description: hasName ? String(r.description ?? r.detail ?? "").trim() || null : null,
      categoryName,
      unit,
      unitInferred: inferred,
      list_price: money(r.list_price ?? r.sell_price ?? r.price ?? r.list),
      customer_priced: cpRaw ? yes(cpRaw) : null,
      active: activeFrom(r),
      sort: money(r.sort) ?? products.length + 1,
    });
  });
  return { products, problems };
}

// Finds the header row (the first row with a "SKU" cell) so title rows above it are skipped.
export function rowsFromGrid(grid: string[][], keyHeaders: string[]): Record<string, string>[] {
  const keys = keyHeaders.map((k) => k.toLowerCase());
  let headerIdx = grid.findIndex((row) => row.some((c) => keys.includes(normalizeHeader(c))));
  if (headerIdx < 0) headerIdx = 0;
  const headers = (grid[headerIdx] ?? []).map(normalizeHeader);
  const out: Record<string, string>[] = [];
  for (const row of grid.slice(headerIdx + 1)) {
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const o: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (h && !(h in o)) o[h] = String(row[j] ?? "");
    });
    out.push(o);
  }
  return out;
}
