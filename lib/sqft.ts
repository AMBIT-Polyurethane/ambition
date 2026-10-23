// Fiberglass batts can be ordered by the bag or by square feet. Square feet always round UP to whole bags.

/** Square feet one bag covers, read from a batt's name ("R11U 23.25”x93”- KNAUF-240.25 S/F 16 PC/BG ..."). Batts only. */
export function sqftFromName(name: string): number | null {
  if (!/^\s*R\s*-?\s*\d{2}/i.test(name)) return null; // batts are named by R-value
  const m = name.match(/(\d+(?:\.\d+)?)\s*S\s*\/\s*F/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whole bags needed to cover the square feet (never rounds down). */
export function bagsFor(sqft: number, perBag: number): number {
  if (!(sqft > 0) || !(perBag > 0)) return 0;
  return Math.ceil(sqft / perBag - 1e-9);
}

/** "1,150" / "1150 sq ft" -> 1150 */
export const parseSqft = (s: string) => {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const sqftText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
