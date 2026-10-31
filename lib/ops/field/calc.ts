// AMBIT-OPS work orders: the numbers the Spray Job Data Log (SDL-01) works out by itself.
// Targets are general SPF practice; the AMBIT product TDS governs.

import type { Area, FieldProduct, Mat, Punch } from "@/lib/ops/field/types";

export const TARGETS = { aboveDewF: 5, woodMcMax: 19, imbalanceMax: 200 } as const;

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : null;
};
export const num = n;

/** Dew point (°F) from air temperature (°F) and relative humidity (%), Magnus formula. */
export function dewPointF(tempF: unknown, rh: unknown): number | null {
  const t = n(tempF);
  const h = n(rh);
  if (t === null || h === null || h <= 0 || h > 100) return null;
  const c = ((t - 32) * 5) / 9;
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(h / 100) + (a * c) / (b + c);
  const dc = (b * g) / (a - g);
  return Math.round(((dc * 9) / 5 + 32) * 10) / 10;
}

/** Core density (lb/ft³) from the density cup: grams of foam in a cup of so many millilitres. */
export function coreDensity(massG: unknown, volMl: unknown): number | null {
  const m = n(massG);
  const v = n(volMl);
  if (m === null || v === null || v <= 0) return null;
  return Math.round((m / v) * 62.428 * 100) / 100;
}

/** A/B pressure imbalance (psi). */
export function imbalance(aPsi: unknown, bPsi: unknown): number | null {
  const a = n(aPsi);
  const b = n(bPsi);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

export type Check = "ok" | "bad" | null;

/** One reading row (start, midday or end): dew point, margin over it and the pass/fail for each. */
export function readingChecks(r: Record<string, unknown> | undefined) {
  const dew = dewPointF(r?.ambient, r?.rh);
  const sub = n(r?.substrate);
  const above = dew !== null && sub !== null ? Math.round((sub - dew) * 10) / 10 : null;
  const mc = n(r?.wood_mc);
  const aboveOk: Check = above === null ? null : above >= TARGETS.aboveDewF ? "ok" : "bad";
  const mcOk: Check = mc === null ? null : mc <= TARGETS.woodMcMax ? "ok" : "bad";
  const all: Check = aboveOk === "bad" || mcOk === "bad" ? "bad" : aboveOk === "ok" || mcOk === "ok" ? "ok" : null;
  return { dew, above, aboveOk, mcOk, all };
}

export const isFoam = (kind: string | null | undefined) => !!kind && kind.startsWith("foam");

/** Sets from the pounds read off the drums (A + B ÷ pounds in a set). */
export function setsFromLbs(a: unknown, b: unknown, lbPerSet: number | null | undefined): number | null {
  const x = n(a);
  const y = n(b);
  if ((x === null && y === null) || !lbPerSet) return null;
  return Math.round((((x ?? 0) + (y ?? 0)) / lbPerSet) * 100) / 100;
}

/** Board feet = sq ft × average inches. */
export const boardFeet = (a: Pick<Area, "sqft" | "thick">) => Math.round((Number(a.sqft) || 0) * (Number(a.thick) || 0) * 10) / 10;

/** Actual yield for each foam product on the work order: board feet sprayed ÷ sets used. */
export function yields(products: FieldProduct[], mats: Mat[], areas: Area[]) {
  const out: { product: FieldProduct; sets: number; bf: number; actual: number | null; expected: number | null; pct: number | null }[] = [];
  const ids = new Set<string>([...mats.filter((m) => isFoam(m.kind) && m.product).map((m) => m.product!), ...areas.filter((a) => isFoam(a.kind) && a.product).map((a) => a.product!)]);
  for (const id of ids) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    const sets = mats.filter((m) => m.product === id).reduce((s, m) => s + (Number(m.qty) || 0), 0);
    const bf = areas.filter((a) => a.product === id).reduce((s, a) => s + boardFeet(a), 0);
    const actual = sets > 0 && bf > 0 ? Math.round(bf / sets) : null;
    const expected = p.yield_bf ? Number(p.yield_bf) : null;
    out.push({ product: p, sets: Math.round(sets * 100) / 100, bf: Math.round(bf), actual, expected, pct: actual && expected ? Math.round((actual / expected) * 100) : null });
  }
  return out;
}

/** Minutes worked in a punch (an open punch counts up to now). */
export const punchMinutes = (p: Pick<Punch, "start" | "end">, now = Date.now()) =>
  Math.max(0, Math.round(((p.end ? Date.parse(p.end) : now) - Date.parse(p.start)) / 60000));

export const hoursText = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export const fmt = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
