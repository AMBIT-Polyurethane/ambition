import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costCents, fillForm } from "@/lib/ai/claude";
import { HEALTH, monthLabels, type Activity, type CrmCustomer, type Lead, type Task } from "@/lib/crm-shared";

// Sales CRM (0109): the AI parts. A morning briefing for each rep and a read on each customer, written by Claude from
// the numbers in A.I. and saved (crm_ai_notes) so a page opens instantly and it only runs once a day per rep / customer.

const MODEL = "claude-sonnet-5-5";
const ABOUT =
  "AMBIT Polyurethane sells spray foam insulation (open and closed cell, sold in sets of two drums), roof coatings, fiberglass, " +
  "spray rigs, guns and parts to insulation contractors in TX, OK, AR, LA, AL, FL and nearby. Reps grow sales by keeping " +
  "contractors reordering on their usual rhythm, winning back ones that went quiet, getting new accounts to a second order, " +
  "and selling more of the line (a foam customer who buys no parts or coatings from AMBIT is a chance).";

export type Brief = {
  headline: string;
  actions: { customer_id: string | null; title: string; why: string }[];
  wins: string[];
};
export type CustomerRead = {
  summary: string;
  next_step: string;
  talking_points: string[];
  opportunities: { item: string; why: string }[];
};
export type AiNote<T> = { body: T; created_at: string; created_by_name: string | null };

export async function readNote<T>(db: SupabaseClient, kind: "brief" | "customer", key: string): Promise<AiNote<T> | null> {
  const { data } = await db.from("crm_ai_notes").select("body, created_at, created_by_name").eq("kind", kind).eq("key", key).maybeSingle<AiNote<T>>();
  return data ?? null;
}

const line = (c: CrmCustomer) =>
  `- id ${c.id} | ${c.name}${c.city ? ` (${c.city}, ${c.state ?? ""})` : ""} | ${HEALTH[c.status].label} | last order ${c.days_since ?? "never"} days ago` +
  `${c.usual_gap ? `, usually every ${c.usual_gap} days` : ""} | 12 months $${Math.round(c.sales_12m)} over ${c.orders_12m} order days` +
  ` | last 90 days $${Math.round(c.sales_90d)} vs $${Math.round(c.sales_prev_90d)} the 90 before`;

/** The rep's morning briefing: what to do today and why. */
export async function writeBrief(db: SupabaseClient, key: string, rep: string, customers: CrmCustomer[], tasks: Task[], leads: Lead[], today: string): Promise<Brief> {
  const by = (s: string) => customers.filter((c) => c.status === s);
  const top = [...customers].sort((a, b) => b.sales_12m - a.sales_12m).slice(0, 15);
  const content = [
    `Rep: ${rep}. Today is ${today}.`,
    `Customers: ${customers.length} (${by("at_risk").length} at risk, ${by("watch").length} to watch, ${by("new").length} new, ${by("inactive").length} inactive).`,
    `This month so far: $${Math.round(customers.reduce((s, c) => s + c.sales_mtd, 0))}.`,
    "",
    "At risk:", ...by("at_risk").slice(0, 15).map(line),
    "Watch:", ...by("watch").slice(0, 15).map(line),
    "New:", ...by("new").slice(0, 10).map(line),
    "Biggest customers:", ...top.map(line),
    "",
    "Open follow-ups:", ...tasks.slice(0, 20).map((t) => `- ${t.title}${t.due_on ? ` (due ${t.due_on})` : ""}`),
    "Pipeline (new customers):", ...leads.filter((l) => l.stage !== "lost").slice(0, 15).map((l) => `- ${l.name}: ${l.stage}, ${l.days_in_stage} days in that step${l.size_note ? `, ${l.size_note}` : ""}`),
  ].join("\n");
  const { data, usage } = await fillForm<Brief>({
    model: MODEL,
    maxTokens: 1500,
    system:
      `${ABOUT}\n\nYou write a sales rep's morning briefing in plain, friendly English for someone reading it on a phone. ` +
      "headline: one or two sentences on where their book stands today. actions: the 3 to 6 most valuable things to do today, " +
      "most important first, each a short imperative title (\"Call Hartley Spray Foam\") with a one-sentence why built from the numbers. " +
      "Use customer_id (the id given) when the action is about one customer, else null. wins: up to 3 short good-news notes (can be empty). " +
      "Only use facts given; never invent orders, prices or people.",
    content,
    name: "brief",
    description: "The rep's briefing.",
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        actions: { type: "array", items: { type: "object", properties: { customer_id: { type: ["string", "null"] }, title: { type: "string" }, why: { type: "string" } }, required: ["customer_id", "title", "why"] } },
        wins: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "actions", "wins"],
    },
  });
  const ids = new Set(customers.map((c) => c.id));
  const body: Brief = { ...data, actions: data.actions.slice(0, 6).map((a) => ({ ...a, customer_id: a.customer_id && ids.has(a.customer_id) ? a.customer_id : null })) };
  await db.rpc("crm_ai_save", { p_kind: "brief", p_key: key, p_body: body, p_model: MODEL, p_cost: costCents(MODEL, usage) });
  return body;
}

type Product = { sku: string | null; name: string; category: string | null; total: number; orders: number; last: string };

/** One customer: where they stand, what to say on the next call, what else they could buy. */
export async function writeCustomerRead(db: SupabaseClient, key: string, c: CrmCustomer, products: Product[], activities: Activity[], today: string): Promise<CustomerRead> {
  const months = monthLabels();
  const content = [
    `Today is ${today}.`,
    line(c),
    `First order on file: ${c.first_day ?? "none"}. Rep: ${c.rep_name ?? (c.house ? "House account" : "none")}.`,
    `Monthly sales, oldest first: ${c.monthly.map((v, i) => `${months[i]} $${Math.round(v)}`).join(", ")}.`,
    "",
    "What they bought in the last 12 months:", ...products.slice(0, 25).map((p) => `- ${p.sku ? `${p.sku} ` : ""}${p.name}${p.category ? ` [${p.category}]` : ""}: $${Math.round(p.total)}, ${p.orders} orders, last ${p.last}`),
    "",
    "Notes from calls and visits (newest first):", ...activities.slice(0, 12).map((a) => `- ${a.occurred_at.slice(0, 10)} ${a.kind} by ${a.created_by_name ?? "?"}: ${a.body.slice(0, 300)}`),
  ].join("\n");
  const { data, usage } = await fillForm<CustomerRead>({
    model: MODEL,
    maxTokens: 1200,
    system:
      `${ABOUT}\n\nYou brief a sales rep on one customer, in plain friendly English. summary: 2 or 3 sentences on how the account is doing ` +
      "(rhythm, trend, what they buy). next_step: the single best next move, one sentence. talking_points: 2 to 4 short things to bring up on " +
      "the next call. opportunities: up to 3 products or product groups they don't buy from AMBIT yet (or buy less of) that a contractor like " +
      "them would use, each with a short why. Only use facts given; say so when there's little history.",
    content,
    name: "customer_read",
    description: "The rep's read on one customer.",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        next_step: { type: "string" },
        talking_points: { type: "array", items: { type: "string" } },
        opportunities: { type: "array", items: { type: "object", properties: { item: { type: "string" }, why: { type: "string" } }, required: ["item", "why"] } },
      },
      required: ["summary", "next_step", "talking_points", "opportunities"],
    },
  });
  await db.rpc("crm_ai_save", { p_kind: "customer", p_key: key, p_body: data, p_model: MODEL, p_cost: costCents(MODEL, usage) });
  return data;
}
