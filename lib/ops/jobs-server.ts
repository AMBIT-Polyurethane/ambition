import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrewPerson, JobLine, Rig, Trip } from "@/lib/ops/schedule";

// AMBIT-OPS jobs, trips, rigs and crews: the reads the screens share. Row-level security decides who
// sees what (sales: the jobs from their quotes; crews: nothing here, they use ops_my_trips).

export const RIG_COLS = "id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, notes, active, sort";
export const TRIP_COLS = "id, job_id, seq, name, status, rig_id, start_date, end_date, days, start_time, notes";
export const LINE_COLS = "id, job_id, trip_id, sort, area_code, product_id, kind, name, detail, sqft, depth_in, r_value, units, unit, bf, price";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function toRig(r: Record<string, unknown>): Rig {
  return {
    id: String(r.id),
    name: String(r.name ?? "Rig"),
    location_id: (r.location_id as string | null) ?? null,
    does: Array.isArray(r.does) ? (r.does as string[]) : [],
    color: (r.color as string | null) ?? null,
    oc_sets_day: Number(r.oc_sets_day ?? 1),
    cc_sets_day: Number(r.cc_sets_day ?? 2),
    sqft_day: Number(r.sqft_day ?? 4000),
    notes: (r.notes as string | null) ?? null,
    active: r.active !== false,
    sort: Number(r.sort ?? 0),
  };
}

export function toLine(r: Record<string, unknown>): JobLine {
  return {
    id: String(r.id),
    job_id: String(r.job_id),
    trip_id: (r.trip_id as string | null) ?? null,
    sort: Number(r.sort ?? 0),
    area_code: (r.area_code as string | null) ?? null,
    product_id: (r.product_id as string | null) ?? null,
    kind: String(r.kind ?? "other"),
    name: String(r.name ?? ""),
    detail: (r.detail as string | null) ?? null,
    sqft: num(r.sqft),
    depth_in: num(r.depth_in),
    r_value: num(r.r_value),
    units: num(r.units),
    unit: (r.unit as string | null) ?? null,
    bf: num(r.bf),
    price: Number(r.price ?? 0),
  };
}

export async function loadRigs(supabase: SupabaseClient, companyId: string, all = false): Promise<Rig[]> {
  let q = supabase.from("ops_rigs").select(RIG_COLS).eq("company_id", companyId).order("sort").order("created_at");
  if (!all) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []).map((r) => toRig(r as Record<string, unknown>));
}

export async function loadCrew(supabase: SupabaseClient, companyId: string, all = false): Promise<CrewPerson[]> {
  let q = supabase.from("ops_crew").select("id, name, phone, profile_id, active").eq("company_id", companyId).order("name");
  if (!all) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as CrewPerson[];
}

/** rig id → its regular crew (crew ids, lead first). */
export async function loadRigCrew(supabase: SupabaseClient, companyId: string) {
  const { data } = await supabase.from("ops_rig_crew").select("rig_id, crew_id, lead").eq("company_id", companyId);
  const map = new Map<string, { crew_id: string; lead: boolean }[]>();
  for (const r of (data ?? []) as { rig_id: string; crew_id: string; lead: boolean }[]) {
    const list = map.get(r.rig_id) ?? [];
    list.push({ crew_id: r.crew_id, lead: r.lead });
    map.set(r.rig_id, list.sort((a, b) => Number(b.lead) - Number(a.lead)));
  }
  return map;
}

export type JobHead = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  sold_total: number | null;
  crew_notes: string | null;
  quote_id: string | null;
  lead_id: string | null;
  customer_id: string;
  created_at: string;
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  property: { id: string; street: string | null; city: string | null; state: string | null; zip: string | null; gate_code: string | null; notes: string | null } | null;
  quote: { number: number } | null;
};

export const JOB_COLS =
  "id, number, title, status, sold_total, crew_notes, quote_id, lead_id, customer_id, created_at, customer:ops_customers(id, name, phone, email), property:ops_properties(id, street, city, state, zip, gate_code, notes), quote:ops_quotes(number)";

export async function loadJob(supabase: SupabaseClient, id: string) {
  const { data: job } = await supabase.from("ops_jobs").select(JOB_COLS).eq("id", id).maybeSingle();
  if (!job) return null;
  const [{ data: trips }, { data: lines }] = await Promise.all([
    supabase.from("ops_trips").select(TRIP_COLS).eq("job_id", id).order("seq"),
    supabase.from("ops_job_lines").select(LINE_COLS).eq("job_id", id).order("sort"),
  ]);
  const tripRows = (trips ?? []) as Trip[];
  const { data: tc } = tripRows.length ? await supabase.from("ops_trip_crew").select("trip_id, crew_id, lead").in("trip_id", tripRows.map((t) => t.id)) : { data: [] };
  return {
    job: job as unknown as JobHead,
    trips: tripRows,
    lines: (lines ?? []).map((r) => toLine(r as Record<string, unknown>)),
    tripCrew: (tc ?? []) as { trip_id: string; crew_id: string; lead: boolean }[],
  };
}

export const addressOf = (p: JobHead["property"]) => (p ? [p.street, p.city, p.state].filter(Boolean).join(", ") : "");
