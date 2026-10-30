// AMBIT-OPS scheduling: rigs, crews, jobs and trips, and the rig board's day math. Shared by the
// server pages and the board (no server-only imports here).

export type Rig = {
  id: string;
  name: string;
  location_id: string | null;
  does: string[];
  color: string | null;
  oc_sets_day: number;
  cc_sets_day: number;
  sqft_day: number;
  notes: string | null;
  active: boolean;
  sort: number;
};

export type CrewPerson = { id: string; name: string; phone: string | null; profile_id: string | null; active: boolean };

export type JobLine = {
  id: string;
  job_id: string;
  trip_id: string | null;
  sort: number;
  area_code: string | null;
  product_id: string | null;
  kind: string;
  name: string;
  detail: string | null;
  sqft: number | null;
  depth_in: number | null;
  r_value: number | null;
  units: number | null;
  unit: string | null;
  bf: number | null;
  price: number;
};

export type TripStatus = "unscheduled" | "scheduled" | "in_progress" | "done" | "cancelled";

export type Trip = {
  id: string;
  job_id: string;
  seq: number;
  name: string;
  status: TripStatus;
  rig_id: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number;
  start_time: string | null;
  notes: string | null;
};

/** What a rig does, in the order the settings show it. */
export const RIG_DOES = [
  { key: "foam_oc", label: "Open cell" },
  { key: "foam_cc", label: "Closed cell" },
  { key: "foam_roof", label: "Roofing foam" },
  { key: "blown", label: "Blown-in" },
  { key: "batt", label: "Batts" },
  { key: "coating", label: "Coatings" },
  { key: "other", label: "Other" },
] as const;

/** Starting numbers for a new rig (the owner's pick for the pilot). */
export const RIG_DEFAULTS = { oc_sets_day: 1, cc_sets_day: 2, sqft_day: 4000 };

/** Colors for rigs on the board (picked in order; each stays readable on light and dark). */
export const RIG_COLORS = ["#2563eb", "#e33527", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#4b5563"];

const SQFT_KINDS = new Set(["blown", "batt", "bibs_mesh", "coating", "intumescent", "removal"]);

/** The work in some lines: open cell and closed cell sets, square feet of the rest. */
export function workOf(lines: Pick<JobLine, "kind" | "units" | "sqft">[]) {
  let oc = 0;
  let cc = 0;
  let sqft = 0;
  for (const l of lines) {
    const u = Number(l.units) || 0;
    if (l.kind === "foam_oc") oc += u;
    else if (l.kind === "foam_cc" || l.kind === "foam_roof" || l.kind === "foam_other") cc += u;
    else if (SQFT_KINDS.has(l.kind)) sqft += Number(l.sqft) || 0;
  }
  return { oc: round2(oc), cc: round2(cc), sqft: Math.round(sqft) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How many days a trip takes on a rig: its sets and square feet against what the rig does in a day. */
export function suggestDays(lines: Pick<JobLine, "kind" | "units" | "sqft">[], rig: Pick<Rig, "oc_sets_day" | "cc_sets_day" | "sqft_day"> | null): number {
  const w = workOf(lines);
  const r = rig ?? { ...RIG_DEFAULTS };
  const d = (r.oc_sets_day > 0 ? w.oc / r.oc_sets_day : 0) + (r.cc_sets_day > 0 ? w.cc / r.cc_sets_day : 0) + (r.sqft_day > 0 ? w.sqft / r.sqft_day : 0);
  return Math.max(1, Math.min(60, Math.ceil(d - 0.05)));
}

/** "1.4 sets open cell · 2,800 sq ft blown" */
export function workText(lines: Pick<JobLine, "kind" | "units" | "sqft">[]): string {
  const w = workOf(lines);
  const parts: string[] = [];
  if (w.oc) parts.push(`${fmt(w.oc)} set${w.oc === 1 ? "" : "s"} open cell`);
  if (w.cc) parts.push(`${fmt(w.cc)} set${w.cc === 1 ? "" : "s"} closed cell`);
  if (w.sqft) parts.push(`${w.sqft.toLocaleString("en-US")} sq ft`);
  return parts.join(" · ") || "No sizes";
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "38.78 bags", "0.27 sets", "6 hr" */
export function unitsText(units: number | null | undefined, unit: string | null | undefined): string | null {
  const n = Number(units);
  if (!units || !Number.isFinite(n)) return null;
  const u = (unit ?? "").trim();
  const plural = n !== 1 && ["bag", "set", "drum", "pail", "roll", "each"].includes(u) ? (u === "each" ? "" : "s") : "";
  return `${fmt(n)}${u ? ` ${u === "each" ? "" : u}${plural}` : ""}`.trim();
}

/** One line of work in plain words: the quote's own description (or the size) and how much material. */
export function lineText(l: { detail?: string | null; sqft?: number | null; depth_in?: number | null; r_value?: number | null; units?: number | null; unit?: string | null }): string {
  const size = l.detail || [l.sqft ? `${Number(l.sqft).toLocaleString("en-US")} sq ft` : null, l.depth_in ? `${l.depth_in}"` : null, l.r_value ? `R-${l.r_value}` : null].filter(Boolean).join(" · ");
  return [size || null, unitsText(l.units, l.unit)].filter(Boolean).join(" · ");
}

// ------------------------------------------------------------------ days (Central time, "YYYY-MM-DD")
export const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a day. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(day, -back);
}

export const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

export function dayParts(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    num: d.getUTCDate(),
    mon: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
  };
}

export const daySpan = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);

/** "Mon, Nov 3" or "Mon, Nov 3 – Wed, Nov 5" */
export function rangeText(start: string | null, days: number): string {
  if (!start) return "Not scheduled";
  const one = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return days > 1 ? `${one(start)} – ${one(addDays(start, days - 1))}` : one(start);
}

/** "7:30 AM" from "07:30:00" */
export function timeText(t: string | null | undefined): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${ap}`;
}

export const TRIP_STATUS: Record<TripStatus, { label: string; cls: string }> = {
  unscheduled: { label: "Not scheduled", cls: "pill warn" },
  scheduled: { label: "Scheduled", cls: "pill info" },
  in_progress: { label: "In progress", cls: "pill ok" },
  done: { label: "Done", cls: "pill ok" },
  cancelled: { label: "Cancelled", cls: "pill grey" },
};
