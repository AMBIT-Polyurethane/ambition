import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { yields } from "@/lib/ops/field/calc";
import type { Area, FieldProduct, Mat, Section } from "@/lib/ops/field/types";

// AMBIT-OPS work orders on the office side (review, PDF) and for AMBIT tech support: everything on one
// work order from ops_wo_detail() (supabase/migrations/0036_ops_work_orders.sql), with photo links.

export type WoDetail = {
  mine: boolean;
  wo: {
    id: string;
    company_id: string;
    trip_id: string;
    job_id: string;
    status: "open" | "done" | "reviewed";
    started_at: string | null;
    finished_at: string | null;
    finished_by_name: string | null;
    sprayer_crew_id: string | null;
    sprayer_name: string | null;
    sprayer_cert: string | null;
    sprayer_signed_at: string | null;
    customer_name: string | null;
    customer_sig: string | null;
    customer_signed_at: string | null;
    customer_absent: boolean;
    customer_absent_note: string | null;
    issue: string | null;
    issue_affected: string | null;
    tech_contacted: boolean | null;
    corrective: string | null;
    notes: string | null;
    share_ambit: boolean;
    shared_at: string | null;
    reviewed_by_name: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    ambit_seen_at?: string | null;
    updated_at: string;
  };
  company: { id: string; name: string; brand: string; logo: string | null; phone: string | null; license_no: string | null; measure_unit: string };
  trip: { id: string; name: string; seq: number; status: string; start_date: string | null; end_date: string | null; days: number };
  job: { id: string; number: number; title: string | null };
  customer: { name: string; phone: string | null; email: string | null };
  property: { street: string | null; city: string | null; state: string | null; zip: string | null };
  rig: { id: string; name: string } | null;
  crew: { id: string; name: string; lead: boolean }[];
  days: ({ id: string; work_date: string; updated_by_name: string | null } & Record<Section, Record<string, unknown>>)[];
  time: { id: string; crew: string; name: string | null; kind: "drive" | "site"; start: string; end: string | null; by: string | null; edited_by: string | null }[];
  materials: {
    id: string;
    work_date: string | null;
    ops_product_id: string | null;
    kind: string;
    name: string;
    unit: string;
    qty: number;
    a_maker: string | null;
    a_lot: string | null;
    b_key: string | null;
    b_lot: string | null;
    lot: string | null;
    serials: string | null;
    measure: { unit?: string; a?: number | null; b?: number | null; start?: number | null; end?: number | null } | null;
    taken: { place: string; item_key: string; maker: string; lot: string; qty: number }[];
    by_name: string | null;
  }[];
  areas: { id: string; work_date: string | null; area_code: string | null; name: string | null; substrate: string | null; ops_product_id: string | null; kind: string | null; sqft: number | null; thick_in: number | null; passes: number | null; bf: number | null }[];
  photos: { id: string; date: string | null; kind: string; path: string; caption: string | null; taken_at: string | null; by: string | null; url?: string | null }[];
  products: { id: string; kind: string; name: string; yield_bf: number | null; lb_per_set: number | null }[];
};

export async function loadWorkOrder(supabase: SupabaseClient, id: string): Promise<WoDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase.rpc("ops_wo_detail", { p_wo: id });
  if (error || !data) return null;
  const d = data as WoDetail;
  if (d.photos.length) {
    const { data: signed } = await supabase.storage.from("ops-photos").createSignedUrls(d.photos.map((p) => p.path), 3600);
    const byPath = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
    d.photos = d.photos.map((p) => ({ ...p, url: byPath.get(p.path) ?? null }));
  }
  return d;
}

export const woLabel = (d: Pick<WoDetail, "job" | "trip">) => `Job #${d.job.number}${d.trip.seq > 1 ? `-${d.trip.seq}` : ""}`;

export const addressText = (p: WoDetail["property"]) => [p.street, [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");

/** Hours on site and driving, per person. */
export function hoursByPerson(time: WoDetail["time"], now = Date.now()) {
  const m = new Map<string, { name: string; site: number; drive: number; open: boolean }>();
  for (const t of time) {
    const cur = m.get(t.crew) ?? { name: t.name ?? "Crew", site: 0, drive: 0, open: false };
    const mins = Math.max(0, Math.round(((t.end ? Date.parse(t.end) : now) - Date.parse(t.start)) / 60000));
    if (t.kind === "site") cur.site += mins;
    else cur.drive += mins;
    if (!t.end) cur.open = true;
    m.set(t.crew, cur);
  }
  return [...m.values()];
}

/** The field-app shapes the yield math uses. */
export function yieldRows(d: WoDetail) {
  const products: FieldProduct[] = d.products.map((p) => ({ id: p.id, kind: p.kind, name: p.name, unit: "set", yield_bf: p.yield_bf, lb_per_set: p.lb_per_set, skus: [], sku: null }));
  const mats = d.materials.map((m) => ({ id: m.id, product: m.ops_product_id, kind: m.kind, qty: Number(m.qty) })) as Mat[];
  const areas = d.areas.map((a) => ({ id: a.id, product: a.ops_product_id, kind: a.kind, sqft: a.sqft, thick: a.thick_in })) as Area[];
  return yields(products, mats, areas);
}
