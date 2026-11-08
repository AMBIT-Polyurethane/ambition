import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { opsCan } from "@/lib/ops/roles";
import { stageName } from "@/lib/ops/defaults";
import type { Workspace } from "@/lib/ops/server";
import type { Profile } from "@/lib/types";

// AMBIT Intelligence in AMBIT-OPS: what it can look up in the contractor's own data, and what it can
// offer to do. Every lookup runs with the person's own login, so the database's walls decide what they
// see (their company only, a sales rep only their own leads, crews only their work). Crews never get
// prices, costs or margins. Nothing is ever saved from here: drafts come back to the screen as cards,
// and the person taps Save (app/(app)/ops/ai-actions.ts).

export type AiCard =
  | { id: string; kind: "open"; path: string; label: string; go: boolean }
  | { id: string; kind: "lead"; draft: LeadDraft }
  | { id: string; kind: "task"; draft: TaskDraft };

export type LeadDraft = {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  title: string | null;
  services: string[];
  source: string | null;
  notes: string | null;
  value_est: number | null;
  next_at: string | null;
  customer_id: string | null;
  customer_name: string | null;
};

export type TaskDraft = { body: string; due_on: string | null; lead_id: string | null; customer_id: string | null; about: string | null };

export type AiCtx = {
  supabase: SupabaseClient;
  profile: Profile;
  ws: Workspace;
  today: string; // YYYY-MM-DD, Central time
  cards: AiCard[];
};

type Tool = Anthropic.Messages.Tool;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[$,]/g, ""))) ? Number(v.replace(/[$,]/g, "")) : null);
const int = (v: unknown) => {
  const n = num(typeof v === "string" ? v.replace(/^#/, "") : v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};
const $ = (n: unknown) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Math.round(Number(n)));
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dayText = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null);
const like = (q: string) => `"%${q.replace(/[%_,()"\\]/g, " ").replace(/\s+/g, " ").trim()}%"`;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const out = (o: unknown) => ({ content: JSON.stringify(o) });
const cardId = () => Math.random().toString(36).slice(2, 10);

/** The paths AMBIT Intelligence may send someone to. */
const SAFE_PATH = /^\/(ops|order|orders|docs|academy|profile|takeoff|assistant)(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9\-_=&%.]*)?$/;

// ------------------------------------------------------------------ the tool list
export function toolsFor(ws: Workspace): Tool[] {
  const r = ws.role;
  const field = opsCan.fieldOnly(r);
  const t: Tool[] = [];
  if (!field) {
    t.push({
      name: "business_snapshot",
      description:
        "The business's key numbers right now: sold this month (and the same days last month), finished-job revenue, job cost, gross profit and margin by month for 12 months, backlog (sold, not done) and weeks of work, the pipeline by stage with dollars, win rate for 90 days, quotes out, follow-ups due, yield (board feet per set) against target by foam type and by rig for 90 days, chemical wasted, today's trips, trips per day for the next 14 days, work orders waiting for review, chemical on hand against the next 14 days, low-yield jobs, hot quotes (opened a lot, not signed) and top customers. Use it for 'how are we doing', KPIs, money, yield, win rate, backlog, what needs attention.",
      input_schema: { type: "object", properties: {} },
    });
  }
  t.push({
    name: "schedule",
    description: field
      ? "This person's own trips (jobs on the schedule) between two dates: customer, address, rig, crew, start time, status. Dates are YYYY-MM-DD."
      : "Trips on the schedule between two dates (inclusive): job number, what the job is, customer and phone, address, rig, crew, start time, day x of y and status. Optional rig name filter. Also lists sold work that isn't scheduled yet when include_unscheduled is true. Dates are YYYY-MM-DD; at most 31 days at a time.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day, YYYY-MM-DD" },
        to: { type: "string", description: "Last day, YYYY-MM-DD (same as from for one day)" },
        rig: { type: "string", description: "Optional: only this rig (part of its name)" },
        include_unscheduled: { type: "boolean", description: "Also list trips waiting to be scheduled" },
      },
      required: ["from"],
    },
  });
  t.push({
    name: "record",
    description: field
      ? "One job by its number: what it is, address, trips and work order status."
      : "Everything about one record: a lead (by number), quote (by number), job (by number) or customer (by name or id). Leads include stage, value, next follow-up date, contact info, address, notes and the latest timeline; quotes include status, views, options and totals; jobs include trips, rigs, work order status, materials and lots used, board feet, yield and job cost; customers include their properties, leads, quotes and jobs.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: field ? ["job"] : ["lead", "quote", "job", "customer"] },
        number: { type: "integer", description: "Lead, quote or job number (#1043 = 1043)" },
        id: { type: "string", description: "Or its id from another lookup" },
        name: { type: "string", description: "Customer name (kind customer)" },
      },
      required: ["kind"],
    },
  });
  if (opsCan.crm(r)) {
    t.push({
      name: "find",
      description:
        "Search customers, leads, quotes and jobs by a name, company, phone number, email, street address, words in a lead or job title, or a number (#1043). Returns matches with their numbers, status and links. Use before record when you don't know the number.",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    });
    t.push({
      name: "follow_ups",
      description:
        "Who needs a call: open leads whose next follow-up date is today or past, quotes sent but not signed (with how many times the customer opened them), and this person's open reminders and tasks.",
      input_schema: { type: "object", properties: {} },
    });
  }
  if (opsCan.jobs(r)) {
    t.push({
      name: "stock",
      description: "Chemical and material on hand at the shop(s) and on each rig, with lot numbers, and items below their reorder point. Optional item filter (part of a name, like 'closed cell' or 'R-19').",
      input_schema: { type: "object", properties: { item: { type: "string" } } },
    });
  }
  t.push({
    name: "open_screen",
    description:
      "Show a button that opens a screen in the app, or open it right away. Use go_now true when they ask to open, show, go to or pull up something; false to just offer it. Paths: /ops (Home), /ops/pipeline (Leads board), /ops/leads/new, /ops/leads/{id}, /ops/customers, /ops/customers/{id}, /ops/customers/import, /ops/quotes, /ops/quotes/new, /ops/quotes/{id}, /ops/schedule, /ops/schedule/rigs, /ops/jobs/{id}, /ops/work-orders, /ops/work-orders/{id}, /ops/stock, /ops/stock/check, /ops/field (crew work orders), /ops/settings and its pages (company, products, pricing, team, pipeline, lead-form, locations, work-orders), /order (order from AMBIT), /orders, /docs, /academy, /profile, /takeoff.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        label: { type: "string", description: "Short button text, like 'Open the schedule' or 'Open lead #1043'" },
        go_now: { type: "boolean" },
      },
      required: ["path", "label", "go_now"],
    },
  });
  if (opsCan.editCrm(r)) {
    t.push({
      name: "draft_lead",
      description:
        "Fill in a new lead from what they told you. It shows on screen as a card they check and save with one tap; nothing is saved until they tap Save. If the person is already a customer (look them up with find first when they give a name you might have), pass customer_id. Put the job (what they want insulated) in title, like 'Attic, open cell' or 'New build: walls and attic'.",
      input_schema: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          company_name: { type: "string", description: "For a builder or business" },
          phone: { type: "string" },
          email: { type: "string" },
          street: { type: "string" },
          city: { type: "string" },
          state: { type: "string", description: "Two letters" },
          zip: { type: "string" },
          title: { type: "string" },
          services: { type: "array", items: { type: "string" } },
          source: { type: "string", description: "Where the lead came from, from their list if it fits" },
          notes: { type: "string" },
          value_est: { type: "number", description: "Estimated job value in dollars, if they said" },
          next_at: { type: "string", description: "Follow-up date YYYY-MM-DD, if they said" },
          customer_id: { type: "string", description: "An existing customer's id" },
        },
      },
    });
    t.push({
      name: "draft_task",
      description:
        "A reminder or to-do for this person (call someone back, order foam, send a quote). Shows as a card they save with one tap. Optionally tied to a lead (by number) or a customer (by id).",
      input_schema: {
        type: "object",
        properties: {
          body: { type: "string", description: "What to do, short, like 'Call Bob Miller about the attic quote'" },
          due_on: { type: "string", description: "YYYY-MM-DD" },
          lead_number: { type: "integer" },
          customer_id: { type: "string" },
        },
        required: ["body"],
      },
    });
  }
  return t;
}

const STATUS: Record<string, string> = {
  business_snapshot: "Pulling up your numbers…",
  schedule: "Checking the schedule…",
  record: "Opening the record…",
  find: "Looking that up…",
  follow_ups: "Checking follow-ups…",
  stock: "Checking stock…",
  open_screen: "Getting that screen…",
  draft_lead: "Filling in the lead…",
  draft_task: "Writing the reminder…",
};
export const toolStatus = (name: string) => STATUS[name] ?? "Working on it…";

// ------------------------------------------------------------------ the lookups
export async function runTool(ctx: AiCtx, name: string, input: Record<string, unknown>): Promise<{ content: string; is_error?: boolean }> {
  const allowed = toolsFor(ctx.ws).some((t) => t.name === name);
  if (!allowed) return { content: "That isn't available to this person.", is_error: true };
  switch (name) {
    case "business_snapshot":
      return snapshot(ctx);
    case "schedule":
      return schedule(ctx, input);
    case "record":
      return record(ctx, input);
    case "find":
      return find(ctx, input);
    case "follow_ups":
      return followUps(ctx);
    case "stock":
      return stock(ctx, input);
    case "open_screen": {
      const path = str(input.path, 300);
      if (!path || !SAFE_PATH.test(path)) return { content: "That isn't a screen in the app. Use one of the listed paths.", is_error: true };
      ctx.cards.push({ id: cardId(), kind: "open", path, label: str(input.label, 60) ?? "Open", go: input.go_now === true });
      return { content: input.go_now === true ? "Opening it now. Say so in a few words." : "A button for it is on screen." };
    }
    case "draft_lead":
      return draftLead(ctx, input);
    case "draft_task":
      return draftTask(ctx, input);
  }
  return { content: "Unknown tool.", is_error: true };
}

type Kpis = {
  today: string;
  sold: { month: number; prev: number; prev_full: number; jobs: number };
  months: { m: string; revenue: number; cost: number; jobs: number; sold: number }[];
  backlog: { value: number; jobs: number; unscheduled: number; weekly: number };
  pipeline: { stages: { key: string; count: number; value: number }[]; won90: number; lost90: number; quotes_out: number; quotes_out_n: number; due: number; new7: number };
  yield: { kinds: { kind: string; bf: number; sets: number; actual: number; target: number | null }[]; rigs: { rig: string; kind: string; actual: number; target: number; sets: number }[]; waste_dollars: number; waste_sets: number };
  today_trips: { job_id: string; job_no: number; title: string | null; customer: string; city: string | null; rig: string | null; status: string; day: number; days: number }[];
  week: { d: string; n: number }[];
  work_orders: { review: number; open: number };
  chem: { oc_need: number; cc_need: number; iso: number; oc: number; cc: number };
  attention: { low_yield: { job_id: string; job_no: number; customer: string; kind: string; pct: number }[]; hot_quotes: { id: string; number: number; customer: string; views: number; total: number }[] };
  customers: { id: string; name: string; jobs: number; revenue: number }[];
};

const KIND_NAME: Record<string, string> = { foam_oc: "open cell", foam_cc: "closed cell", foam_roof: "roofing foam" };

async function snapshot(ctx: AiCtx) {
  const { data, error } = await ctx.supabase.rpc("ops_kpis");
  if (error || !data) return { content: "The numbers aren't available for this login.", is_error: true };
  const k = data as Kpis;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const decided = k.pipeline.won90 + k.pipeline.lost90;
  return out({
    today: k.today,
    sold_this_month: { dollars: $(k.sold.month), jobs_signed: k.sold.jobs, same_days_last_month: $(k.sold.prev), all_of_last_month: $(k.sold.prev_full) },
    finished_jobs_by_month: k.months.map((m) => ({ month: m.m, revenue: $(m.revenue), job_cost: $(m.cost), gross_profit: $(m.revenue - m.cost), margin_pct: pct(m.revenue - m.cost, m.revenue), jobs_finished: m.jobs, sold: $(m.sold) })),
    backlog: { sold_not_done: $(k.backlog.value), jobs: k.backlog.jobs, not_scheduled: k.backlog.unscheduled, weeks_of_work: k.backlog.weekly > 0 ? Math.round((k.backlog.value / k.backlog.weekly) * 10) / 10 : null },
    pipeline: {
      open_by_stage: k.pipeline.stages.map((s) => ({ stage: stageName(ctx.ws.settings, s.key), leads: s.count, dollars: $(s.value) })),
      won_last_90_days: k.pipeline.won90,
      lost_last_90_days: k.pipeline.lost90,
      win_rate_pct: decided ? pct(k.pipeline.won90, decided) : null,
      quotes_out_dollars: $(k.pipeline.quotes_out),
      quotes_out: k.pipeline.quotes_out_n,
      follow_ups_due: k.pipeline.due,
      new_leads_last_7_days: k.pipeline.new7,
    },
    yield_last_90_days: {
      note: "board feet per set; pct_of_target 100 = on target",
      by_foam: k.yield.kinds.map((y) => ({ foam: KIND_NAME[y.kind] ?? y.kind, bf: $(y.bf), sets: y.sets, bf_per_set: $(y.actual), target: y.target, pct_of_target: y.target ? pct(y.actual, y.target) : null })),
      by_rig: k.yield.rigs.map((y) => ({ rig: y.rig, foam: KIND_NAME[y.kind] ?? y.kind, bf_per_set: $(y.actual), target: y.target, pct_of_target: pct(y.actual, y.target), sets: y.sets })),
      chemical_wasted_dollars: $(k.yield.waste_dollars),
      chemical_wasted_sets: k.yield.waste_sets,
    },
    today_trips: k.today_trips.slice(0, 15).map((t) => ({ job: `#${t.job_no}`, what: t.title, customer: t.customer, city: t.city, rig: t.rig, status: t.status, day: `${t.day} of ${t.days}`, path: `/ops/jobs/${t.job_id}` })),
    trips_per_day_next_14: k.week.map((w) => ({ day: dayText(w.d), trips: w.n })),
    work_orders: { waiting_for_review: k.work_orders.review, open: k.work_orders.open, review_path: "/ops/work-orders" },
    chemical_next_14_days: {
      note: "drums on hand at the shop and rigs vs. drums the scheduled jobs need",
      open_cell_resin: { on_hand: k.chem.oc, needed: k.chem.oc_need },
      closed_cell_resin: { on_hand: k.chem.cc, needed: k.chem.cc_need },
      iso: { on_hand: k.chem.iso, needed: Math.round((k.chem.oc_need + k.chem.cc_need) * 10) / 10 },
      order_path: "/order",
    },
    low_yield_jobs: k.attention.low_yield.map((j) => ({ job: `#${j.job_no}`, customer: j.customer, foam: KIND_NAME[j.kind] ?? j.kind, pct_of_target: j.pct, path: `/ops/jobs/${j.job_id}` })),
    hot_quotes: k.attention.hot_quotes.map((q) => ({ quote: `#${q.number}`, customer: q.customer, times_opened: q.views, total: $(q.total), path: `/ops/quotes/${q.id}` })),
    top_customers_12_months: k.customers.map((c) => ({ name: c.name, jobs: c.jobs, sold: $(c.revenue), path: `/ops/customers/${c.id}` })),
  });
}

type TripRow = {
  id: string;
  job_id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  days: number;
  start_time: string | null;
  rig: { name: string } | { name: string }[] | null;
  job: {
    number: number;
    title: string | null;
    customer: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null;
    property: { street: string | null; city: string | null } | { street: string | null; city: string | null }[] | null;
  } | null;
  crew: { lead: boolean; crew: { name: string } | { name: string }[] | null }[] | null;
};

const TRIP_COLS =
  "id, job_id, name, status, start_date, end_date, days, start_time, rig:ops_rigs(name), job:ops_jobs(number, title, customer:ops_customers(name, phone), property:ops_properties(street, city)), crew:ops_trip_crew(lead, crew:ops_crew(name))";

function tripOut(t: TripRow, field: boolean, from?: string) {
  const job = one(t.job);
  const cust = one(job?.customer);
  const prop = one(job?.property);
  const dayNo = from && t.start_date && t.days > 1 ? Math.min(t.days, Math.max(1, Math.round((Date.parse(from) - Date.parse(t.start_date)) / 86400000) + 1)) : null;
  return {
    job: job ? `#${job.number}` : null,
    what: job?.title ?? t.name,
    trip: t.name,
    customer: cust?.name ?? null,
    phone: cust?.phone ?? null,
    address: [prop?.street, prop?.city].filter(Boolean).join(", ") || null,
    rig: one(t.rig)?.name ?? null,
    crew: (t.crew ?? []).map((c) => `${one(c.crew)?.name ?? ""}${c.lead ? " (lead)" : ""}`).filter((x) => x.trim()),
    start: t.start_date ? `${dayText(t.start_date)}${t.start_time ? ` ${t.start_time.slice(0, 5)}` : ""}` : null,
    days: t.days,
    ...(dayNo ? { on_from_day: `day ${dayNo} of ${t.days}` } : {}),
    status: t.status,
    path: field ? "/ops/field" : `/ops/jobs/${t.job_id}`,
  };
}

async function schedule(ctx: AiCtx, input: Record<string, unknown>) {
  const field = opsCan.fieldOnly(ctx.ws.role);
  let from = str(input.from, 10) && DATE.test(String(input.from)) ? String(input.from) : ctx.today;
  let to = str(input.to, 10) && DATE.test(String(input.to)) ? String(input.to) : from;
  if (to < from) [from, to] = [to, from];
  if (Date.parse(to) - Date.parse(from) > 31 * 86400000) to = addDays(from, 31);
  const { data, error } = await ctx.supabase
    .from("ops_trips")
    .select(TRIP_COLS)
    .eq("company_id", ctx.ws.company.id)
    .lte("start_date", to)
    .gte("end_date", from)
    .neq("status", "cancelled")
    .neq("status", "unscheduled")
    .order("start_date")
    .order("start_time", { nullsFirst: false })
    .limit(120);
  if (error) return { content: `Couldn't read the schedule: ${error.message}`, is_error: true };
  let rows = (data ?? []) as unknown as TripRow[];
  const rig = str(input.rig, 60)?.toLowerCase();
  if (rig) rows = rows.filter((t) => (one(t.rig)?.name ?? "").toLowerCase().includes(rig));
  const res: Record<string, unknown> = {
    from: dayText(from),
    to: dayText(to),
    trips: rows.map((t) => tripOut(t, field, from)),
    rigs_note: "A trip can run several days; it shows on each day from start through start + days - 1.",
    schedule_path: field ? "/ops/field" : "/ops/schedule",
  };
  if (input.include_unscheduled === true && !field) {
    const { data: un } = await ctx.supabase
      .from("ops_trips")
      .select(TRIP_COLS)
      .eq("company_id", ctx.ws.company.id)
      .eq("status", "unscheduled")
      .order("created_at")
      .limit(30);
    res.not_scheduled_yet = ((un ?? []) as unknown as TripRow[]).map((t) => tripOut(t, field));
  }
  return out(res);
}

async function record(ctx: AiCtx, input: Record<string, unknown>) {
  const kind = String(input.kind ?? "");
  const co = ctx.ws.company.id;
  const field = opsCan.fieldOnly(ctx.ws.role);
  const n = int(input.number);
  const id = str(input.id, 40);
  const byId = id && uuid.test(id) ? id : null;

  if (kind === "lead" && !field) {
    let q = ctx.supabase
      .from("ops_leads")
      .select("id, number, title, stage, source, services, value_est, next_at, notes, created_at, won_at, lost_at, lost_reason, customer:ops_customers(id, name, phone, email, price_level), property:ops_properties(street, city, state, zip)")
      .eq("company_id", co);
    q = byId ? q.eq("id", byId) : q.eq("number", n ?? -1);
    const { data: l } = await q.maybeSingle();
    if (!l) return out({ found: false, note: "No lead with that number this person can see." });
    const [{ data: notes }, { data: quotes }] = await Promise.all([
      ctx.supabase.from("ops_notes").select("kind, body, due_on, done_at, created_by_name, created_at").eq("lead_id", l.id).order("created_at", { ascending: false }).limit(8),
      ctx.supabase.from("ops_quotes").select("id, number, status, sent_at, view_count, signed_total, totals").eq("lead_id", l.id).order("created_at"),
    ]);
    const c = one(l.customer as unknown as { id: string; name: string; phone: string | null; email: string | null; price_level: string });
    const p = one(l.property as unknown as { street: string | null; city: string | null; state: string | null; zip: string | null });
    return out({
      lead: `#${l.number}`,
      title: l.title,
      stage: stageName(ctx.ws.settings, l.stage as string),
      source: l.source,
      services: l.services,
      value_estimate: $(l.value_est),
      next_follow_up: dayText(l.next_at as string | null),
      created: dayText(String(l.created_at).slice(0, 10)),
      lost_reason: l.lost_reason,
      notes: (l.notes as string | null)?.slice(0, 800) ?? null,
      customer: c ? { name: c.name, phone: c.phone, email: c.email, builder_pricing: c.price_level === "builder", path: `/ops/customers/${c.id}` } : null,
      address: p ? [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ") : null,
      timeline_newest_first: (notes ?? []).map((x) => ({ kind: x.kind, text: String(x.body).slice(0, 300), due: dayText(x.due_on as string | null), done: !!x.done_at, by: x.created_by_name, at: dayText(String(x.created_at).slice(0, 10)) })),
      quotes: (quotes ?? []).map((x) => ({ quote: `#${x.number}`, status: x.status, sent: dayText(x.sent_at ? String(x.sent_at).slice(0, 10) : null), times_opened: x.view_count, total: $(x.signed_total ?? quoteTotal(x.totals)), path: `/ops/quotes/${x.id}` })),
      path: `/ops/leads/${l.id}`,
    });
  }

  if (kind === "quote" && !field) {
    let q = ctx.supabase
      .from("ops_quotes")
      .select("id, number, title, status, sent_at, viewed_at, view_count, signed_at, signed_name, signed_total, signed_option_id, declined_at, decline_reason, valid_until, totals, lead_id, customer:ops_customers(id, name, phone, email), options:ops_quote_options(id, name, sort)")
      .eq("company_id", co);
    q = byId ? q.eq("id", byId) : q.eq("number", n ?? -1);
    const { data: x } = await q.maybeSingle();
    if (!x) return out({ found: false, note: "No quote with that number this person can see." });
    const t = (x.totals ?? {}) as { options?: Record<string, { price?: number; cost?: number; margin?: number; total?: number; deposit?: number }> };
    const c = one(x.customer as unknown as { id: string; name: string; phone: string | null; email: string | null });
    const opts = ((x.options ?? []) as { id: string; name: string; sort: number }[]).sort((a, b) => a.sort - b.sort);
    return out({
      quote: `#${x.number}`,
      title: x.title,
      status: x.status,
      sent: dayText(x.sent_at ? String(x.sent_at).slice(0, 10) : null),
      last_opened: dayText(x.viewed_at ? String(x.viewed_at).slice(0, 10) : null),
      times_opened: x.view_count,
      good_until: dayText(x.valid_until as string | null),
      signed: x.signed_at ? { on: dayText(String(x.signed_at).slice(0, 10)), by: x.signed_name, total: $(x.signed_total) } : null,
      declined: x.declined_at ? { on: dayText(String(x.declined_at).slice(0, 10)), reason: x.decline_reason } : null,
      options: opts.map((o) => {
        const v = t.options?.[o.id] ?? {};
        return { name: o.name, total: $(v.total ?? v.price), margin_pct: v.margin !== undefined ? Math.round(Number(v.margin) * 10) / 10 : null, job_cost: $(v.cost), deposit: $(v.deposit), signed: x.signed_option_id === o.id };
      }),
      customer: c ? { name: c.name, phone: c.phone, email: c.email, path: `/ops/customers/${c.id}` } : null,
      lead_path: x.lead_id ? `/ops/leads/${x.lead_id}` : null,
      path: `/ops/quotes/${x.id}`,
    });
  }

  if (kind === "job") {
    let q = ctx.supabase
      .from("ops_jobs")
      .select("id, number, title, status, sold_total, crew_notes, created_at, quote_id, customer:ops_customers(id, name, phone), property:ops_properties(street, city, state, zip, gate_code)")
      .eq("company_id", co);
    q = byId ? q.eq("id", byId) : q.eq("number", n ?? -1);
    const { data: j } = await q.maybeSingle();
    if (!j) return out({ found: false, note: "No job with that number this person can see." });
    const [{ data: trips }, { data: wos }] = await Promise.all([
      ctx.supabase.from("ops_trips").select("id, name, status, start_date, days, start_time, rig:ops_rigs(name)").eq("job_id", j.id).order("seq"),
      ctx.supabase.from("ops_work_orders").select("id, trip_id, status, finished_at, reviewed_at, issue").eq("job_id", j.id),
    ]);
    const woIds = (wos ?? []).map((w) => w.id as string);
    const [{ data: mats }, { data: areas }] = woIds.length
      ? await Promise.all([
          ctx.supabase.from("ops_wo_materials").select("kind, name, unit, qty, a_lot, b_lot, lot, ops_product_id").in("wo_id", woIds).eq("deleted", false),
          ctx.supabase.from("ops_wo_areas").select("kind, bf, sqft").in("wo_id", woIds).eq("deleted", false),
        ])
      : [{ data: [] }, { data: [] }];
    const used = new Map<string, { name: string; unit: string; qty: number; lots: Set<string> }>();
    for (const m of mats ?? []) {
      const key = `${m.name}|${m.unit}`;
      const u = used.get(key) ?? { name: m.name as string, unit: m.unit as string, qty: 0, lots: new Set<string>() };
      u.qty += Number(m.qty) || 0;
      for (const l of [m.a_lot, m.b_lot, m.lot]) if (l) u.lots.add(String(l));
      used.set(key, u);
    }
    const sets: Record<string, number> = {};
    for (const m of mats ?? []) if (String(m.kind).startsWith("foam_")) sets[m.kind as string] = (sets[m.kind as string] ?? 0) + (Number(m.qty) || 0);
    const bf: Record<string, number> = {};
    for (const a of areas ?? []) if (String(a.kind).startsWith("foam_")) bf[a.kind as string] = (bf[a.kind as string] ?? 0) + (Number(a.bf) || 0);
    const targets: Record<string, number> = { foam_oc: 16500, foam_cc: 3700 };
    const yields = Object.keys(sets).map((k2) => {
      const per = sets[k2] ? (bf[k2] ?? 0) / sets[k2] : 0;
      return { foam: KIND_NAME[k2] ?? k2, sets: Math.round(sets[k2] * 100) / 100, board_feet: $(bf[k2] ?? 0), bf_per_set: $(per), pct_of_typical_target: targets[k2] ? Math.round((per / targets[k2]) * 1000) / 10 : null };
    });
    const c = one(j.customer as unknown as { id: string; name: string; phone: string | null });
    const p = one(j.property as unknown as { street: string | null; city: string | null; state: string | null; zip: string | null; gate_code: string | null });
    const woByTrip = new Map((wos ?? []).map((w) => [w.trip_id as string, w]));
    return out({
      job: `#${j.number}`,
      title: j.title,
      status: j.status,
      ...(field ? {} : { sold_total: $(j.sold_total) }),
      customer: c ? { name: c.name, phone: c.phone, ...(field ? {} : { path: `/ops/customers/${c.id}` }) } : null,
      address: p ? [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ") : null,
      gate_code: p?.gate_code ?? null,
      crew_notes: j.crew_notes,
      trips: (trips ?? []).map((t) => {
        const w = woByTrip.get(t.id as string);
        return {
          trip: t.name,
          status: t.status,
          start: t.start_date ? `${dayText(t.start_date as string)}${t.start_time ? ` ${String(t.start_time).slice(0, 5)}` : ""}` : "not scheduled",
          days: t.days,
          rig: one(t.rig as unknown as { name: string } | null)?.name ?? null,
          work_order: w ? { status: w.status, finished: dayText(w.finished_at ? String(w.finished_at).slice(0, 10) : null), reviewed: !!w.reviewed_at, issue: w.issue ?? null, ...(field ? {} : { path: `/ops/work-orders/${w.id}` }) } : null,
        };
      }),
      materials_used: [...used.values()].map((u) => ({ name: u.name, qty: Math.round(u.qty * 100) / 100, unit: u.unit, lots: [...u.lots].slice(0, 6) })),
      yield: yields,
      path: field ? "/ops/field" : `/ops/jobs/${j.id}`,
      quote_path: !field && j.quote_id ? `/ops/quotes/${j.quote_id}` : null,
    });
  }

  if (kind === "customer" && !field) {
    let q = ctx.supabase.from("ops_customers").select("id, name, kind, phone, phone2, email, notes, source, price_level, tax_exempt, created_at").eq("company_id", co);
    const nm = str(input.name, 80);
    if (byId) q = q.eq("id", byId);
    else if (nm) q = q.ilike("name", `%${nm.replace(/[%_]/g, " ")}%`);
    else return { content: "Give a customer name or id.", is_error: true };
    const { data: list } = await q.order("name").limit(5);
    const c = (list ?? [])[0];
    if (!c) return out({ found: false, note: "No customer by that name this person can see. Try find with part of the name or a phone number." });
    const [{ data: props }, { data: leads }, { data: quotes }, { data: jobs }] = await Promise.all([
      ctx.supabase.from("ops_properties").select("label, street, city, state, zip").eq("customer_id", c.id).limit(10),
      ctx.supabase.from("ops_leads").select("id, number, title, stage, value_est, next_at").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(10),
      ctx.supabase.from("ops_quotes").select("id, number, title, status, signed_total, totals").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(10),
      ctx.supabase.from("ops_jobs").select("id, number, title, status, sold_total, created_at").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(12),
    ]);
    return out({
      customer: c.name,
      type: c.kind === "company" ? "company / builder" : "person",
      phone: c.phone,
      phone2: c.phone2,
      email: c.email,
      builder_pricing: c.price_level === "builder",
      tax_exempt: c.tax_exempt,
      source: c.source,
      notes: (c.notes as string | null)?.slice(0, 500) ?? null,
      since: dayText(String(c.created_at).slice(0, 10)),
      properties: (props ?? []).map((x) => [x.label, x.street, x.city, x.state, x.zip].filter(Boolean).join(", ")),
      leads: (leads ?? []).map((x) => ({ lead: `#${x.number}`, title: x.title, stage: stageName(ctx.ws.settings, x.stage as string), value: $(x.value_est), next_follow_up: dayText(x.next_at as string | null), path: `/ops/leads/${x.id}` })),
      quotes: (quotes ?? []).map((x) => ({ quote: `#${x.number}`, title: x.title, status: x.status, total: $(x.signed_total ?? quoteTotal(x.totals)), path: `/ops/quotes/${x.id}` })),
      jobs: (jobs ?? []).map((x) => ({ job: `#${x.number}`, title: x.title, status: x.status, sold: $(x.sold_total), path: `/ops/jobs/${x.id}` })),
      total_sold: $((jobs ?? []).reduce((a, x) => a + (Number(x.sold_total) || 0), 0)),
      other_matches: (list ?? []).slice(1).map((x) => ({ name: x.name, id: x.id })),
      path: `/ops/customers/${c.id}`,
    });
  }
  return { content: "Pick kind lead, quote, job or customer.", is_error: true };
}

function quoteTotal(totals: unknown): number | null {
  const t = (totals ?? {}) as { options?: Record<string, { total?: number; price?: number }> };
  const vals = Object.values(t.options ?? {}).map((o) => Number(o.total ?? o.price ?? 0)).filter((v) => v > 0);
  return vals.length ? Math.max(...vals) : null;
}

async function find(ctx: AiCtx, input: Record<string, unknown>) {
  const raw = str(input.query, 120);
  if (!raw) return { content: "Say what to look for.", is_error: true };
  const co = ctx.ws.company.id;
  const s = ctx.ws.settings;
  const number = /^#?\s*(\d{3,7})$/.exec(raw);
  const res: Record<string, unknown> = {};
  if (number) {
    const nn = Number(number[1]);
    const [{ data: l }, { data: q }, { data: j }] = await Promise.all([
      ctx.supabase.from("ops_leads").select("id, number, title, stage, customer:ops_customers(name)").eq("company_id", co).eq("number", nn).limit(1),
      ctx.supabase.from("ops_quotes").select("id, number, title, status, customer:ops_customers(name)").eq("company_id", co).eq("number", nn).limit(1),
      ctx.supabase.from("ops_jobs").select("id, number, title, status, customer:ops_customers(name)").eq("company_id", co).eq("number", nn).limit(1),
    ]);
    res.leads = (l ?? []).map((x) => ({ lead: `#${x.number}`, title: x.title, stage: stageName(s, x.stage as string), customer: one(x.customer as unknown as { name: string })?.name, path: `/ops/leads/${x.id}` }));
    res.quotes = (q ?? []).map((x) => ({ quote: `#${x.number}`, title: x.title, status: x.status, customer: one(x.customer as unknown as { name: string })?.name, path: `/ops/quotes/${x.id}` }));
    res.jobs = (j ?? []).map((x) => ({ job: `#${x.number}`, title: x.title, status: x.status, customer: one(x.customer as unknown as { name: string })?.name, path: `/ops/jobs/${x.id}` }));
    return out(res);
  }
  const pat = like(raw);
  const digits = raw.replace(/\D/g, "");
  const ors = [`name.ilike.${pat}`, `company_name.ilike.${pat}`, `email.ilike.${pat}`];
  if (digits.length >= 4) ors.push(`phone.ilike."%${digits.slice(-4)}%"`);
  const [{ data: custs }, { data: props }, { data: leads }, { data: jobs }] = await Promise.all([
    ctx.supabase.from("ops_customers").select("id, name, kind, phone, email").eq("company_id", co).or(ors.join(",")).order("name").limit(8),
    ctx.supabase.from("ops_properties").select("customer_id, street, city").eq("company_id", co).ilike("street", `%${raw.replace(/[%_]/g, " ")}%`).limit(8),
    ctx.supabase.from("ops_leads").select("id, number, title, stage, customer:ops_customers(name)").eq("company_id", co).ilike("title", `%${raw.replace(/[%_]/g, " ")}%`).order("created_at", { ascending: false }).limit(6),
    ctx.supabase.from("ops_jobs").select("id, number, title, status, customer:ops_customers(name)").eq("company_id", co).ilike("title", `%${raw.replace(/[%_]/g, " ")}%`).order("created_at", { ascending: false }).limit(6),
  ]);
  const ids = [...new Set([...(custs ?? []).map((c) => c.id as string), ...(props ?? []).map((p) => p.customer_id as string)])].slice(0, 10);
  const [{ data: cl }, { data: cq }, { data: cj }, { data: extra }] = ids.length
    ? await Promise.all([
        ctx.supabase.from("ops_leads").select("id, number, title, stage, customer_id").in("customer_id", ids).order("created_at", { ascending: false }).limit(25),
        ctx.supabase.from("ops_quotes").select("id, number, title, status, customer_id, signed_total, totals").in("customer_id", ids).order("created_at", { ascending: false }).limit(25),
        ctx.supabase.from("ops_jobs").select("id, number, title, status, customer_id, sold_total").in("customer_id", ids).order("created_at", { ascending: false }).limit(25),
        ctx.supabase.from("ops_customers").select("id, name, kind, phone, email").in("id", ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const field = opsCan.fieldOnly(ctx.ws.role);
  res.customers = (extra ?? []).map((c) => ({
    name: c.name,
    id: c.id,
    type: c.kind === "company" ? "company / builder" : "person",
    phone: c.phone,
    email: c.email,
    addresses: (props ?? []).filter((p) => p.customer_id === c.id).map((p) => [p.street, p.city].filter(Boolean).join(", ")),
    leads: (cl ?? []).filter((x) => x.customer_id === c.id).slice(0, 6).map((x) => ({ lead: `#${x.number}`, title: x.title, stage: stageName(s, x.stage as string), path: `/ops/leads/${x.id}` })),
    quotes: (cq ?? []).filter((x) => x.customer_id === c.id).slice(0, 6).map((x) => ({ quote: `#${x.number}`, status: x.status, ...(field ? {} : { total: $(x.signed_total ?? quoteTotal(x.totals)) }), path: `/ops/quotes/${x.id}` })),
    jobs: (cj ?? []).filter((x) => x.customer_id === c.id).slice(0, 6).map((x) => ({ job: `#${x.number}`, title: x.title, status: x.status, ...(field ? {} : { sold: $(x.sold_total) }), path: `/ops/jobs/${x.id}` })),
    path: `/ops/customers/${c.id}`,
  }));
  res.leads_by_title = (leads ?? []).map((x) => ({ lead: `#${x.number}`, title: x.title, stage: stageName(s, x.stage as string), customer: one(x.customer as unknown as { name: string })?.name, path: `/ops/leads/${x.id}` }));
  res.jobs_by_title = (jobs ?? []).map((x) => ({ job: `#${x.number}`, title: x.title, status: x.status, customer: one(x.customer as unknown as { name: string })?.name, path: `/ops/jobs/${x.id}` }));
  if (!(extra ?? []).length && !(leads ?? []).length && !(jobs ?? []).length) res.note = "Nothing matched. Try part of the name, the last 4 digits of the phone, or the street.";
  return out(res);
}

async function followUps(ctx: AiCtx) {
  const co = ctx.ws.company.id;
  const me = ctx.profile.id;
  const s = ctx.ws.settings;
  const [{ data: leads }, { data: quotes }, { data: tasks }] = await Promise.all([
    ctx.supabase
      .from("ops_leads")
      .select("id, number, title, stage, next_at, value_est, customer:ops_customers(name, phone)")
      .eq("company_id", co)
      .not("stage", "in", "(won,lost)")
      .lte("next_at", ctx.today)
      .order("next_at")
      .limit(20),
    ctx.supabase
      .from("ops_quotes")
      .select("id, number, title, status, sent_at, viewed_at, view_count, totals, customer:ops_customers(name, phone)")
      .eq("company_id", co)
      .in("status", ["sent", "viewed"])
      .order("view_count", { ascending: false })
      .order("sent_at")
      .limit(20),
    ctx.supabase
      .from("ops_notes")
      .select("id, body, due_on, lead_id, customer_id, lead:ops_leads(number)")
      .eq("company_id", co)
      .eq("kind", "task")
      .is("done_at", null)
      .or(`assigned_to.eq.${me},and(assigned_to.is.null,created_by.eq.${me})`)
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(15),
  ]);
  return out({
    today: dayText(ctx.today),
    leads_due: (leads ?? []).map((l) => {
      const c = one(l.customer as unknown as { name: string; phone: string | null });
      return { lead: `#${l.number}`, title: l.title, stage: stageName(s, l.stage as string), due: dayText(l.next_at as string), overdue_days: Math.max(0, Math.round((Date.parse(ctx.today) - Date.parse(String(l.next_at))) / 86400000)), value: $(l.value_est), customer: c?.name, phone: c?.phone, path: `/ops/leads/${l.id}` };
    }),
    quotes_waiting: (quotes ?? []).map((x) => {
      const c = one(x.customer as unknown as { name: string; phone: string | null });
      return { quote: `#${x.number}`, title: x.title, sent: dayText(x.sent_at ? String(x.sent_at).slice(0, 10) : null), last_opened: dayText(x.viewed_at ? String(x.viewed_at).slice(0, 10) : null), times_opened: x.view_count, total: $(quoteTotal(x.totals)), customer: c?.name, phone: c?.phone, path: `/ops/quotes/${x.id}` };
    }),
    my_reminders: (tasks ?? []).map((t) => ({
      text: String(t.body).slice(0, 200),
      due: dayText(t.due_on as string | null),
      overdue: !!t.due_on && String(t.due_on) < ctx.today,
      lead: one(t.lead as unknown as { number: number })?.number ? `#${one(t.lead as unknown as { number: number })!.number}` : null,
      path: t.lead_id ? `/ops/leads/${t.lead_id}` : t.customer_id ? `/ops/customers/${t.customer_id}` : "/ops",
    })),
  });
}

/** "closed cell" finds AMBI-TITE, "open cell" AMBI-SEAL, "iso" the A side. */
function itemMatch(item: string | null) {
  if (!item) return () => true;
  const q = item.toLowerCase();
  const res = [q];
  if (/closed/.test(q)) res.push("tite", "closed");
  if (/open/.test(q)) res.push("seal", "open");
  if (/\biso\b|a.?side/.test(q)) res.push("iso", "a-side");
  if (/resin|b.?side/.test(q)) res.push("resin");
  return (name: string) => res.some((r) => name.toLowerCase().includes(r));
}

async function stock(ctx: AiCtx, input: Record<string, unknown>) {
  const co = ctx.ws.company.id;
  const match = itemMatch(str(input.item, 60));
  const [{ data: rows, error }, { data: locs }, { data: rigs }, { data: mins }] = await Promise.all([
    ctx.supabase.from("ops_stock").select("place_kind, place_id, item_key, name, unit, maker, lot_no, qty").eq("company_id", co).neq("qty", 0).order("name").limit(400),
    ctx.supabase.from("ops_locations").select("id, name").eq("company_id", co),
    ctx.supabase.from("ops_rigs").select("id, name").eq("company_id", co),
    ctx.supabase.from("ops_stock_min").select("item_key, name, unit, min_qty").eq("company_id", co),
  ]);
  if (error) return { content: `Couldn't read stock: ${error.message}`, is_error: true };
  const place = new Map<string, string>([...(locs ?? []).map((l) => [l.id as string, `Shop: ${l.name}`] as [string, string]), ...(rigs ?? []).map((r) => [r.id as string, `Rig: ${r.name}`] as [string, string])]);
  const byPlace: Record<string, { item: string; maker: string | null; lot: string | null; qty: number; unit: string }[]> = {};
  const totals = new Map<string, number>();
  let shown = 0;
  for (const r of rows ?? []) {
    totals.set(r.item_key as string, (totals.get(r.item_key as string) ?? 0) + Number(r.qty));
    if (!match(r.name as string) || shown >= 150) continue;
    shown++;
    const p = place.get(r.place_id as string) ?? (r.place_kind === "rig" ? "A rig" : "A shop");
    (byPlace[p] ??= []).push({ item: r.name as string, maker: (r.maker as string) || null, lot: (r.lot_no as string) || null, qty: Number(r.qty), unit: r.unit as string });
  }
  const low = (mins ?? [])
    .filter((m) => Number(m.min_qty) > 0 && (totals.get(m.item_key as string) ?? 0) < Number(m.min_qty) && match(m.name as string))
    .map((m) => ({ item: m.name, on_hand: Math.round((totals.get(m.item_key as string) ?? 0) * 100) / 100, reorder_at: Number(m.min_qty), unit: m.unit }));
  return out({ by_place: byPlace, below_reorder_point: low, ...(shown ? {} : { note: "Nothing on hand matches that." }), stock_path: "/ops/stock", order_path: "/order" });
}

async function draftLead(ctx: AiCtx, input: Record<string, unknown>) {
  let customerId = str(input.customer_id, 40);
  let customerName: string | null = null;
  if (customerId) {
    if (!uuid.test(customerId)) customerId = null;
    else {
      const { data: c } = await ctx.supabase.from("ops_customers").select("id, name").eq("company_id", ctx.ws.company.id).eq("id", customerId).maybeSingle();
      customerId = (c?.id as string) ?? null;
      customerName = (c?.name as string) ?? null;
    }
  }
  const email = str(input.email, 160)?.toLowerCase() ?? null;
  const d: LeadDraft = {
    first_name: str(input.first_name, 60),
    last_name: str(input.last_name, 60),
    company_name: str(input.company_name, 120),
    phone: str(input.phone, 40),
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    street: str(input.street, 160),
    city: str(input.city, 80),
    state: str(input.state, 2)?.toUpperCase() ?? null,
    zip: str(input.zip, 10),
    title: str(input.title, 140),
    services: Array.isArray(input.services) ? input.services.map((x) => String(x).slice(0, 60)).slice(0, 8) : [],
    source: str(input.source, 60),
    notes: str(input.notes, 2000),
    value_est: num(input.value_est),
    next_at: str(input.next_at, 10) && DATE.test(String(input.next_at)) ? String(input.next_at) : null,
    customer_id: customerId,
    customer_name: customerName,
  };
  if (!d.customer_id && !d.company_name && !d.first_name && !d.last_name) return { content: "Ask for the customer's name first.", is_error: true };
  ctx.cards.push({ id: cardId(), kind: "lead", draft: d });
  return { content: "The lead is on screen as a card they can check, fix and save with one tap. It is NOT saved until they tap Save. Mention anything important that's missing (like a phone number) in one short line." };
}

async function draftTask(ctx: AiCtx, input: Record<string, unknown>) {
  const body = str(input.body, 400);
  if (!body) return { content: "Say what the reminder is.", is_error: true };
  let leadId: string | null = null;
  let customerId = str(input.customer_id, 40);
  let about: string | null = null;
  const ln = int(input.lead_number);
  if (ln) {
    const { data: l } = await ctx.supabase.from("ops_leads").select("id, number, customer_id, customer:ops_customers(name)").eq("company_id", ctx.ws.company.id).eq("number", ln).maybeSingle();
    if (l) {
      leadId = l.id as string;
      customerId = l.customer_id as string;
      about = `Lead #${l.number}${one(l.customer as unknown as { name: string })?.name ? ` · ${one(l.customer as unknown as { name: string })!.name}` : ""}`;
    }
  } else if (customerId && uuid.test(customerId)) {
    const { data: c } = await ctx.supabase.from("ops_customers").select("id, name").eq("company_id", ctx.ws.company.id).eq("id", customerId).maybeSingle();
    customerId = (c?.id as string) ?? null;
    about = (c?.name as string) ?? null;
  } else customerId = null;
  const due = str(input.due_on, 10) && DATE.test(String(input.due_on)) ? String(input.due_on) : null;
  ctx.cards.push({ id: cardId(), kind: "task", draft: { body, due_on: due, lead_id: leadId, customer_id: customerId, about } });
  return { content: "The reminder is on screen as a card with a Save button. It is NOT saved until they tap Save." };
}
