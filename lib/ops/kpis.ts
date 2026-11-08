// What public.ops_kpis() returns (supabase/migrations/0048_ops_demo_and_brand.sql): the Home dashboard,
// the daily briefing and AMBIT Intelligence all read it.
export type Kpis = {
  today: string;
  sold: { month: number; prev: number; prev_full: number; jobs: number };
  months: { m: string; revenue: number; cost: number; jobs: number; sold: number }[];
  backlog: { value: number; jobs: number; unscheduled: number; weekly: number };
  pipeline: { stages: { key: string; count: number; value: number }[]; won90: number; lost90: number; quotes_out: number; quotes_out_n: number; due: number; new7: number };
  yield: {
    kinds: { kind: string; bf: number; sets: number; actual: number; target: number | null }[];
    rigs: { rig: string; color: string | null; kind: string; actual: number; target: number; sets: number }[];
    waste_dollars: number;
    waste_sets: number;
  };
  today_trips: { id: string; job_id: string; job_no: number; title: string | null; customer: string; city: string | null; rig: string | null; color: string | null; status: string; day: number; days: number; wo_open: boolean }[];
  week: { d: string; n: number }[];
  rigs: number;
  work_orders: { review: number; open: number };
  chem: { oc_need: number; cc_need: number; iso: number; oc: number; cc: number };
  attention: {
    low_yield: { job_id: string; job_no: number; customer: string; kind: string; pct: number }[];
    hot_quotes: { id: string; number: number; customer: string; views: number; total: number }[];
  };
  customers: { id: string; name: string; kind: string; jobs: number; revenue: number }[];
};
