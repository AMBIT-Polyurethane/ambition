// AMBIT-OPS: the numbers and lists every contractor starts with (Build Plan, "Defaults loaded on day
// one"). Saved per contractor in companies.ops_settings; anything not saved falls back to these.

export type Stage = { key: string; name: string };
export type WorkArea = { code: string; name: string };
export type LaborMethod = "per_set" | "per_sqft" | "per_bf" | "hourly";
export type LaborRate = { key: string; name: string; method: LaborMethod; rate: number | null; hours_per_unit?: number | null };
export type MeasureUnit = "lbs" | "gallons" | "strokes";

export type OpsSettings = {
  display_name: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  license_no: string;
  color: string;
  measure_unit: MeasureUnit;
  target_margin: number | null;
  builder_margin: number | null;
  floor_margin: number | null;
  burden_pct: number | null;
  waste_pct: number;
  quote_days: number;
  followup_days: number[];
  deposit_pct: number | null;
  min_job: number | null;
  tax_rate: number | null;
  tax_labor: boolean;
  show_line_prices: boolean;
  stages: Stage[];
  sources: string[];
  lost_reasons: string[];
  work_areas: WorkArea[];
  services: string[];
  labor: LaborRate[];
};

/** The pipeline. "won" and "lost" are always there and always last; the rest can be renamed or added. */
export const DEFAULT_STAGES: Stage[] = [
  { key: "new", name: "New lead" },
  { key: "contacted", name: "Contacted" },
  { key: "appointment", name: "Appointment set" },
  { key: "quoted", name: "Quote sent" },
  { key: "follow_up", name: "Follow-up" },
  { key: "won", name: "Won" },
  { key: "lost", name: "Lost" },
];
export const CLOSED = ["won", "lost"];

export const DEFAULT_SOURCES = ["Website form", "Phone call", "Referral", "Builder", "Google", "Facebook", "Angi / HomeAdvisor", "Door knocking", "AMBIT referral"];
export const DEFAULT_LOST = ["Price", "Timing", "Went with a competitor", "No response", "Other"];
export const DEFAULT_WORK_AREAS: WorkArea[] = [
  { code: "EW", name: "Exterior walls" },
  { code: "PW", name: "Partition walls" },
  { code: "KW", name: "Knee walls" },
  { code: "CL", name: "Ceiling" },
  { code: "RL", name: "Roofline" },
  { code: "RJ", name: "Rim joist" },
];
export const DEFAULT_SERVICES = ["Spray foam insulation", "Blown-in insulation", "Batt insulation", "Insulation removal", "Air sealing", "Roof coating"];

/** Labor defaults (Jeremiah, Oct 29 2026). Blanks are filled in by each contractor. */
export const DEFAULT_LABOR: LaborRate[] = [
  { key: "foam_oc", name: "Open cell foam", method: "per_set", rate: 500 },
  { key: "foam_cc", name: "Closed cell foam", method: "per_set", rate: 450 },
  { key: "foam_roof", name: "Roofing foam", method: "per_set", rate: null },
  { key: "prep", name: "Prep and cleanup", method: "hourly", rate: null },
  { key: "blown_attic", name: "Loose-fill attic", method: "per_sqft", rate: 0.05 },
  { key: "bibs_mesh", name: "BIBS mesh install", method: "per_sqft", rate: 0.05 },
  { key: "bibs_2x4", name: "BIBS blow-in, 2x4 walls", method: "per_sqft", rate: 0.05 },
  { key: "bibs_2x6", name: "BIBS blow-in, 2x6 walls", method: "per_sqft", rate: 0.07 },
  { key: "batt_r11_13", name: "Batts, R-11 and R-13", method: "per_sqft", rate: 0.04 },
  { key: "batt_r19", name: "Batts, R-19", method: "per_sqft", rate: 0.05 },
  { key: "batt_r30_38", name: "Batts, R-30 and R-38", method: "per_sqft", rate: 0.06 },
  { key: "intumescent", name: "Intumescent coating", method: "per_sqft", rate: 0.05 },
  { key: "removal", name: "Insulation removal", method: "per_sqft", rate: null },
  { key: "air_seal", name: "Air sealing", method: "hourly", rate: null },
];

export const LABOR_METHODS: { key: LaborMethod; label: string; unit: string }[] = [
  { key: "per_set", label: "Per set", unit: "set" },
  { key: "per_sqft", label: "Per sq ft", unit: "sq ft" },
  { key: "per_bf", label: "Per board foot", unit: "bd ft" },
  { key: "hourly", label: "Per hour", unit: "hr" },
];

export const MEASURE_UNITS: { key: MeasureUnit; label: string; hint: string }[] = [
  { key: "lbs", label: "Pounds", hint: "Crews enter pounds used from each drum" },
  { key: "gallons", label: "Gallons", hint: "Crews enter gallons used from each drum" },
  { key: "strokes", label: "Stroke counter", hint: "Crews enter the proportioner's stroke counter start and end" },
];

/** Yield defaults (board feet per set). Changing them shows a caution first. AMBI-ROOF: AMBIT's published 2,800. */
export const YIELD_DEFAULTS = { foam_oc: 16500, foam_cc: 3700, foam_roof: 2800 } as const;

export const DEFAULT_SETTINGS: OpsSettings = {
  display_name: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  license_no: "",
  color: "",
  measure_unit: "lbs",
  target_margin: null,
  builder_margin: null,
  floor_margin: null,
  burden_pct: null,
  waste_pct: 10,
  quote_days: 30,
  followup_days: [2, 5, 10],
  deposit_pct: null,
  min_job: null,
  tax_rate: null,
  tax_labor: false,
  show_line_prices: false,
  stages: DEFAULT_STAGES,
  sources: DEFAULT_SOURCES,
  lost_reasons: DEFAULT_LOST,
  work_areas: DEFAULT_WORK_AREAS,
  services: DEFAULT_SERVICES,
  labor: DEFAULT_LABOR,
};

const arr = <T,>(v: unknown, ok: (x: unknown) => x is T): T[] | null => (Array.isArray(v) && v.every(ok) ? (v as T[]) : null);
const isStr = (x: unknown): x is string => typeof x === "string";
const isStage = (x: unknown): x is Stage => !!x && typeof x === "object" && isStr((x as Stage).key) && isStr((x as Stage).name);
const isArea = (x: unknown): x is WorkArea => !!x && typeof x === "object" && isStr((x as WorkArea).code) && isStr((x as WorkArea).name);
const isLabor = (x: unknown): x is LaborRate => !!x && typeof x === "object" && isStr((x as LaborRate).key) && isStr((x as LaborRate).name);
const num = (v: unknown, d: number | null) => (typeof v === "number" && Number.isFinite(v) ? v : v === null ? null : d);

/** A contractor's settings with every default filled in. */
export function settingsOf(raw: unknown): OpsSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: keyof OpsSettings) => (isStr(r[k]) ? (r[k] as string) : (DEFAULT_SETTINGS[k] as string));
  let stages = arr(r.stages, isStage) ?? DEFAULT_STAGES;
  // Won and Lost always exist, at the end.
  stages = [...stages.filter((x) => !CLOSED.includes(x.key)), stages.find((x) => x.key === "won") ?? DEFAULT_STAGES[5], stages.find((x) => x.key === "lost") ?? DEFAULT_STAGES[6]];
  // Labor: saved rates, plus any default added since they saved.
  const savedLabor = arr(r.labor, isLabor) ?? [];
  const labor = [...savedLabor, ...DEFAULT_LABOR.filter((d) => !savedLabor.some((x) => x.key === d.key))];
  return {
    display_name: s("display_name"),
    phone: s("phone"),
    email: s("email"),
    website: s("website"),
    address: s("address"),
    license_no: s("license_no"),
    color: /^#[0-9a-f]{6}$/i.test(String(r.color ?? "")) ? String(r.color) : "",
    measure_unit: (["lbs", "gallons", "strokes"] as const).includes(r.measure_unit as MeasureUnit) ? (r.measure_unit as MeasureUnit) : "lbs",
    target_margin: num(r.target_margin, null),
    builder_margin: num(r.builder_margin, null),
    floor_margin: num(r.floor_margin, null),
    burden_pct: num(r.burden_pct, null),
    waste_pct: num(r.waste_pct, 10) ?? 10,
    quote_days: num(r.quote_days, 30) ?? 30,
    followup_days: arr(r.followup_days, (x): x is number => typeof x === "number") ?? DEFAULT_SETTINGS.followup_days,
    deposit_pct: num(r.deposit_pct, null),
    min_job: num(r.min_job, null),
    tax_rate: num(r.tax_rate, null),
    tax_labor: r.tax_labor === true,
    show_line_prices: r.show_line_prices === true,
    stages,
    sources: arr(r.sources, isStr) ?? DEFAULT_SOURCES,
    lost_reasons: arr(r.lost_reasons, isStr) ?? DEFAULT_LOST,
    work_areas: arr(r.work_areas, isArea) ?? DEFAULT_WORK_AREAS,
    services: arr(r.services, isStr) ?? DEFAULT_SERVICES,
    labor,
  };
}

export const stageName = (s: OpsSettings, key: string) => s.stages.find((x) => x.key === key)?.name ?? key;
