// AMBIT-OPS field app (crew work orders): what the phone downloads (ops_field_bundle in
// supabase/migrations/0036_ops_work_orders.sql) and the changes it sends back (ops_wo_sync).
// No prices anywhere in here.

export type FieldCrew = { id: string; name: string; login: boolean; lead?: boolean; me?: boolean | null };

export type FieldProduct = {
  id: string;
  kind: string;
  name: string;
  unit: string;
  yield_bf: number | null;
  lb_per_set: number | null;
  skus: string[];
  sku: string | null;
};

export type StockLot = { place: "rig" | "location"; item_key: string; name: string; unit: string; maker: string; lot_no: string; qty: number };

export type WorkLine = {
  id: string;
  area: string | null;
  name: string;
  detail: string | null;
  kind: string;
  product_id: string | null;
  sqft: number | null;
  depth_in: number | null;
  r_value: number | null;
  units: number | null;
  unit: string | null;
  bf: number | null;
};

export type Punch = { id: string; crew: string; kind: "drive" | "site"; start: string; end: string | null; by?: string | null };

export type Measure = { unit?: string; a?: number | null; b?: number | null; start?: number | null; end?: number | null };

export type Mat = {
  id: string;
  date: string | null;
  product: string | null;
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
  measure: Measure | null;
  taken?: { place: string; item_key: string; maker: string; lot: string; qty: number }[];
  by?: string | null;
};

export type Area = {
  id: string;
  date: string | null;
  line: string | null;
  area: string | null;
  name: string | null;
  substrate: string | null;
  product: string | null;
  kind: string | null;
  sqft: number | null;
  thick: number | null;
  passes: number | null;
  sort: number;
};

export type Photo = { id: string; date: string | null; kind: "before" | "after" | "issue" | "other"; path: string; caption: string | null; taken_at: string | null; by?: string | null };

export type Section = "conditions" | "equipment" | "material" | "quality" | "safety";
export type DayLog = { date: string; updated_by_name?: string | null } & Record<Section, Record<string, unknown>>;

export type WoHead = {
  id?: string;
  status: "open" | "done" | "reviewed";
  started_at: string | null;
  finished_at: string | null;
  finished_by_name?: string | null;
  sprayer_crew_id: string | null;
  sprayer_name: string | null;
  sprayer_cert: string | null;
  customer_name: string | null;
  customer_signed: boolean;
  customer_signed_at?: string | null;
  customer_absent: boolean;
  customer_absent_note: string | null;
  issue: string | null;
  issue_affected: string | null;
  tech_contacted: boolean | null;
  corrective: string | null;
  notes: string | null;
  share_ambit?: boolean;
  reviewed_at?: string | null;
  review_note?: string | null;
};

export type FieldTrip = {
  id: string;
  name: string;
  seq: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  start_time: string | null;
  notes: string | null;
  job: { id: string; number: number; title: string | null; crew_notes: string | null };
  customer: { name: string; phone: string | null };
  address: string | null;
  gate_code: string | null;
  property_notes: string | null;
  rig: { id: string; name: string; location_id: string | null } | null;
  crew: FieldCrew[];
  work: WorkLine[];
  stock: StockLot[];
  wo: WoHead | null;
  days_log: DayLog[];
  time: Punch[];
  materials: Mat[];
  areas: Area[];
  photos: Photo[];
};

export type FieldSettings = {
  brand: string;
  measure_unit: "lbs" | "gallons" | "strokes";
  work_areas: { code: string; name: string }[] | null;
  share_logs: boolean;
};

export type Bundle = {
  company: string;
  role: string;
  office: boolean;
  lead: boolean;
  me: string | null;
  me_name: string | null;
  today: string;
  at: string;
  settings: FieldSettings;
  crew: FieldCrew[];
  products: FieldProduct[];
  trips: FieldTrip[];
};

// ---------- Changes the phone sends ----------
type Base = { trip: string; at: string };
export type TimeOp = Base & { t: "time"; id: string; crew: string; kind: "drive" | "site"; start: string; end: string | null; deleted?: boolean };
export type DayOp = Base & { t: "day"; date: string } & Partial<Record<Section, Record<string, unknown>>>;
export type MatOp = Base & {
  t: "mat";
  id: string;
  date: string | null;
  product: string | null;
  kind?: string;
  name?: string;
  unit?: string;
  qty: number;
  a_maker?: string | null;
  a_lot?: string | null;
  b_key?: string | null;
  b_lot?: string | null;
  lot?: string | null;
  serials?: string | null;
  measure?: Measure | null;
  deleted?: boolean;
};
export type AreaOp = Base & {
  t: "area";
  id: string;
  date: string | null;
  line?: string | null;
  area?: string | null;
  name?: string | null;
  substrate?: string | null;
  product?: string | null;
  kind?: string | null;
  sqft?: number | null;
  thick?: number | null;
  passes?: number | null;
  sort?: number;
  deleted?: boolean;
};
export type PhotoOp = Base & { t: "photo"; id: string; date: string | null; kind: Photo["kind"]; path: string; caption?: string | null; taken_at?: string | null; deleted?: boolean };
export type WoOp = Base & {
  t: "wo";
  issue?: string | null;
  issue_affected?: string | null;
  tech_contacted?: boolean | null;
  corrective?: string | null;
  notes?: string | null;
  sprayer_crew_id?: string | null;
  sprayer_cert?: string | null;
};
export type FinishOp = Base & {
  t: "finish";
  sprayer_crew?: string | null;
  sprayer_name: string;
  sprayer_cert?: string | null;
  customer_name?: string | null;
  customer_sig?: string | null;
  customer_absent?: boolean;
  customer_absent_note?: string | null;
};

export type Op = TimeOp | DayOp | MatOp | AreaOp | PhotoOp | WoOp | FinishOp;

/** A change waiting in the phone's outbox. */
export type Queued = { seq: number; op: Op; tries: number; last_error?: string | null };
/** A change the server turned down for good (shown to the crew so nothing disappears silently). */
export type Failed = { op: Op; error: string; at: string };
