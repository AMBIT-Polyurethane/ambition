import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, CrmCustomer, Lead, Task } from "@/lib/crm-shared";

// Sales CRM (0109): reading with the person's own login. The database decides whose customers they see
// (a rep: their own; admins and "Sales dashboard": everyone).

export const CRM_NEEDS = "The Sales CRM needs database update 0109 first (Supabase > SQL Editor).";

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function crmCustomers(db: SupabaseClient, rep: string | null, company: string | null = null): Promise<{ rows: CrmCustomer[]; error: string | null }> {
  const { data, error } = await db.rpc("crm_customers", { p_rep: rep, p_company: company });
  if (error) return { rows: [], error: /crm_customers|schema cache|function/i.test(error.message) ? CRM_NEEDS : error.message };
  const rows = ((data ?? []) as CrmCustomer[]).map((c) => ({
    ...c,
    days_since: c.days_since === null ? null : num(c.days_since),
    usual_gap: c.usual_gap === null ? null : num(c.usual_gap),
    orders_12m: num(c.orders_12m),
    sales_12m: num(c.sales_12m),
    sales_90d: num(c.sales_90d),
    sales_prev_90d: num(c.sales_prev_90d),
    sales_mtd: num(c.sales_mtd),
    monthly: (c.monthly ?? []).map(num),
  }));
  return { rows, error: null };
}

export async function crmLeads(db: SupabaseClient, rep: string | null): Promise<Lead[]> {
  const { data } = await db.rpc("crm_leads_list", { p_rep: rep });
  return ((data ?? []) as Lead[]).map((l) => ({ ...l, orders: num(l.orders), days_in_stage: num(l.days_in_stage) }));
}

/** Open follow-ups: one person's (null = everyone's, for admins). */
export async function crmTasks(db: SupabaseClient, who: string | null, opts: { company?: string; lead?: string; done?: boolean } = {}): Promise<Task[]> {
  let q = db.from("crm_tasks").select("id, company_id, lead_id, title, due_on, assigned_name, source, done_at, created_by_name").order("due_on", { ascending: true, nullsFirst: false }).limit(300);
  if (who) q = q.eq("assigned_to", who);
  if (opts.company) q = q.eq("company_id", opts.company);
  if (opts.lead) q = q.eq("lead_id", opts.lead);
  q = opts.done ? q.not("done_at", "is", null) : q.is("done_at", null);
  const { data } = await q;
  return (data ?? []) as Task[];
}

export async function crmActivities(db: SupabaseClient, opts: { company?: string; lead?: string; by?: string; limit?: number }): Promise<Activity[]> {
  let q = db.from("crm_activities").select("id, company_id, lead_id, kind, body, created_by_name, occurred_at").order("occurred_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.company) q = q.eq("company_id", opts.company);
  if (opts.lead) q = q.eq("lead_id", opts.lead);
  if (opts.by) q = q.eq("created_by", opts.by);
  const { data } = await q;
  return (data ?? []) as Activity[];
}

/** The last touch (call, visit, note…) on each customer, for "no contact in N days". */
export async function lastTouches(db: SupabaseClient, companies: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!companies.length) return out;
  for (let i = 0; i < companies.length; i += 300) {
    const { data } = await db.from("crm_activities").select("company_id, occurred_at").in("company_id", companies.slice(i, i + 300)).order("occurred_at", { ascending: false }).limit(3000);
    for (const r of (data ?? []) as { company_id: string; occurred_at: string }[]) if (!out.has(r.company_id)) out.set(r.company_id, r.occurred_at);
  }
  return out;
}

export type HistoryMeta = { from_date: string | null; through_date: string | null; rows: number | null; imported_at: string | null; imported_by_name: string | null };
export async function historyMeta(db: SupabaseClient): Promise<HistoryMeta | null> {
  const { data } = await db.from("sales_history_meta").select("from_date, through_date, rows, imported_at, imported_by_name").eq("id", 1).maybeSingle<HistoryMeta>();
  return data ?? null;
}

/** People a rep's customers can belong to (for admins' "Rep" picker): sales reps and anyone with customers. */
export async function repList(db: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data } = await db.from("profiles").select("id, full_name, email, job_role, perms, role").in("role", ["employee", "admin"]).eq("status", "active").eq("demo", false).order("full_name");
  const { data: owners } = await db.from("companies").select("sales_rep_id").not("sales_rep_id", "is", null).limit(5000);
  const has = new Set(((owners ?? []) as { sales_rep_id: string }[]).map((o) => o.sales_rep_id));
  return ((data ?? []) as { id: string; full_name: string | null; email: string; job_role: string | null; perms: string[] | null }[])
    .filter((p) => p.job_role === "sales_rep" || has.has(p.id) || (p.perms ?? []).includes("sales_hub"))
    .map((p) => ({ id: p.id, name: (p.full_name || p.email).trim() }));
}

/** What the rep's day looks like, in one list, most urgent first. */
export type Alert = { kind: "at_risk" | "watch" | "new" | "task" | "lead"; title: string; detail: string; href: string; tone: "red" | "warn" | "info" };

export function buildAlerts(customers: CrmCustomer[], tasks: Task[], leads: Lead[], today: string): Alert[] {
  const out: Alert[] = [];
  for (const t of tasks) {
    if (t.due_on && t.due_on <= today) {
      out.push({ kind: "task", title: t.title, detail: t.due_on < today ? `Follow-up was due ${t.due_on}` : "Follow-up due today", href: t.company_id ? `/sales/customers/${t.company_id}` : "/sales/pipeline", tone: t.due_on < today ? "red" : "warn" });
    }
  }
  for (const c of customers) {
    if (c.status === "at_risk") {
      out.push({ kind: "at_risk", title: c.name, detail: `No order in ${c.days_since} days. They usually order every ${c.usual_gap} days.`, href: `/sales/customers/${c.id}`, tone: "red" });
    } else if (c.status === "watch") {
      const down = c.sales_prev_90d > 0 && c.sales_90d < c.sales_prev_90d * 0.6;
      out.push({
        kind: "watch",
        title: c.name,
        detail: down
          ? `Spending is down ${Math.round((1 - c.sales_90d / c.sales_prev_90d) * 100)}% from the 3 months before.`
          : c.usual_gap
            ? `${c.days_since} days since the last order. They usually order every ${c.usual_gap} days.`
            : `${c.days_since} days since the last order.`,
        href: `/sales/customers/${c.id}`,
        tone: "warn",
      });
    } else if (c.status === "new" && c.orders_12m === 1 && (c.days_since ?? 0) >= 21) {
      out.push({ kind: "new", title: c.name, detail: `New customer: one order ${c.days_since} days ago. Time for the second one.`, href: `/sales/customers/${c.id}`, tone: "info" });
    }
  }
  for (const l of leads) {
    if (l.stage !== "lost" && l.stage !== "repeat" && l.days_in_stage >= 7) {
      out.push({ kind: "lead", title: l.name, detail: `${l.days_in_stage} days in "${stageLabel(l.stage)}".`, href: "/sales/pipeline", tone: "info" });
    }
  }
  const rank = { red: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

function stageLabel(s: string) {
  return ({ lead: "Lead", app_sent: "Credit app sent", credit_review: "Credit review", approved: "Approved", first_order: "First order", repeat: "Repeat", lost: "Lost" } as Record<string, string>)[s] ?? s;
}

export const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
