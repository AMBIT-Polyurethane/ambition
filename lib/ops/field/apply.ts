// AMBIT-OPS field app: shows changes on the phone right away, before they reach the server. The
// same rules as ops_wo_apply() in the database, so what the crew sees matches what gets saved.

import type { Area, Bundle, DayLog, FieldTrip, Mat, Op, Photo, Punch, Section, WoHead } from "@/lib/ops/field/types";

export const SECTIONS: Section[] = ["conditions", "equipment", "material", "quality", "safety"];

export const emptyWo = (): WoHead => ({
  status: "open",
  started_at: null,
  finished_at: null,
  sprayer_crew_id: null,
  sprayer_name: null,
  sprayer_cert: null,
  customer_name: null,
  customer_signed: false,
  customer_absent: false,
  customer_absent_note: null,
  issue: null,
  issue_affected: null,
  tech_contacted: null,
  corrective: null,
  notes: null,
});

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
/** Key by key, all the way down (the same as ops_jsonb_merge in the database). */
export function deepMerge(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (!isObj(a) || !isObj(b)) return b;
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v;
  return out;
}

const upsert = <T extends { id: string }>(list: T[], row: T, deleted?: boolean) => {
  const rest = list.filter((x) => x.id !== row.id);
  return deleted ? rest : [...rest, row];
};

function applyOne(tr: FieldTrip, op: Op, crewNames: Map<string, string>) {
  const wo = tr.wo ?? emptyWo();
  tr.wo = wo;
  if (op.t !== "finish" && tr.status === "scheduled") tr.status = "in_progress";
  switch (op.t) {
    case "time": {
      const row: Punch = { id: op.id, crew: op.crew, kind: op.kind, start: op.start, end: op.end };
      tr.time = upsert(tr.time, row, op.deleted).sort((a, b) => a.start.localeCompare(b.start));
      if (!op.deleted && !tr.crew.some((c) => c.id === op.crew)) tr.crew = [...tr.crew, { id: op.crew, name: crewNames.get(op.crew) ?? "Crew", login: false, lead: false }];
      const first = tr.time[0]?.start ?? null;
      wo.started_at = first;
      break;
    }
    case "day": {
      const day: DayLog = tr.days_log.find((d) => d.date === op.date) ?? { date: op.date, conditions: {}, equipment: {}, material: {}, quality: {}, safety: {} };
      for (const s of SECTIONS) if (op[s]) day[s] = deepMerge(day[s] ?? {}, op[s]) as Record<string, unknown>;
      tr.days_log = [...tr.days_log.filter((d) => d.date !== op.date), day].sort((a, b) => a.date.localeCompare(b.date));
      break;
    }
    case "mat": {
      const old = tr.materials.find((m) => m.id === op.id);
      const row: Mat = {
        id: op.id,
        date: op.date,
        product: op.product,
        kind: op.kind ?? old?.kind ?? "other",
        name: op.name ?? old?.name ?? "Material",
        unit: op.unit ?? old?.unit ?? "each",
        qty: Number(op.qty) || 0,
        a_maker: op.a_maker ?? null,
        a_lot: op.a_lot ?? null,
        b_key: op.b_key ?? null,
        b_lot: op.b_lot ?? null,
        lot: op.lot ?? null,
        serials: op.serials ?? null,
        measure: op.measure ?? null,
        taken: undefined,
      };
      tr.materials = upsert(tr.materials, row, op.deleted);
      break;
    }
    case "area": {
      const old = tr.areas.find((a) => a.id === op.id);
      const row: Area = {
        id: op.id,
        date: op.date,
        line: op.line ?? old?.line ?? null,
        area: op.area ?? null,
        name: op.name ?? null,
        substrate: op.substrate ?? null,
        product: op.product ?? null,
        kind: op.kind ?? null,
        sqft: op.sqft ?? null,
        thick: op.thick ?? null,
        passes: op.passes ?? null,
        sort: op.sort ?? old?.sort ?? tr.areas.length,
      };
      tr.areas = upsert(tr.areas, row, op.deleted).sort((a, b) => a.sort - b.sort);
      break;
    }
    case "photo": {
      const row: Photo = { id: op.id, date: op.date, kind: op.kind, path: op.path, caption: op.caption ?? null, taken_at: op.taken_at ?? null };
      tr.photos = upsert(tr.photos, row, op.deleted);
      break;
    }
    case "wo": {
      const { t: _t, trip: _tr, at: _at, ...rest } = op;
      Object.assign(wo, rest);
      break;
    }
    case "finish": {
      if (wo.status !== "open") break;
      wo.status = "done";
      wo.finished_at = op.at;
      wo.sprayer_name = op.sprayer_name;
      wo.sprayer_crew_id = op.sprayer_crew ?? wo.sprayer_crew_id;
      wo.sprayer_cert = op.sprayer_cert ?? wo.sprayer_cert;
      wo.customer_absent = !!op.customer_absent;
      wo.customer_absent_note = op.customer_absent ? op.customer_absent_note ?? null : null;
      wo.customer_name = op.customer_absent ? null : op.customer_name ?? null;
      wo.customer_signed = !op.customer_absent && !!op.customer_sig;
      tr.status = "done";
      break;
    }
  }
}

/** The downloaded data with the changes still waiting to be sent laid on top. */
export function applyOps(bundle: Bundle | null, ops: Op[]): Bundle | null {
  if (!bundle) return null;
  if (!ops.length) return bundle;
  const b: Bundle = structuredClone(bundle);
  const byId = new Map(b.trips.map((t) => [t.id, t]));
  const crewNames = new Map(b.crew.map((c) => [c.id, c.name]));
  for (const op of ops) {
    const tr = byId.get(op.trip);
    if (tr) applyOne(tr, op, crewNames);
  }
  return b;
}

/** Two changes to the same thing can be sent as one (the newer wins; log sections merge). */
export function sameTarget(a: Op, b: Op) {
  if (a.t !== b.t || a.trip !== b.trip) return false;
  if (a.t === "day" && b.t === "day") return a.date === b.date;
  if (a.t === "wo") return true;
  if ("id" in a && "id" in b) return a.id === b.id;
  return false;
}

export function mergeOps(older: Op, newer: Op): Op {
  if (older.t === "day" && newer.t === "day") {
    const out: Record<string, unknown> = { ...older, at: newer.at };
    for (const s of SECTIONS) if (older[s] || newer[s]) out[s] = deepMerge(older[s] ?? {}, newer[s] ?? {});
    return out as Op;
  }
  if (older.t === "wo" && newer.t === "wo") return { ...older, ...newer };
  return newer;
}
