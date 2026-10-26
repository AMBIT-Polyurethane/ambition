import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qtyText } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import type { OrderDraft } from "@/components/order-builder";

// Smart reorder: what a customer usually orders and how often, worked out from their past orders
// (supabase/migrations/0021: reorder_suggestions, customers_due).

export type UsualItem = {
  product_id: string;
  name: string;
  unit: string;
  times: number;
  usual_days: number;
  usual_qty: number;
  last_at: string;
  next_due: string; // YYYY-MM-DD
  days_until: number; // negative = overdue
};

export function rhythm(days: number): string {
  if (days < 10) return `every ${Math.round(days)} days`;
  if (days < 56) {
    const w = Math.round(days / 7);
    return w <= 1 ? "every week" : `every ${w} weeks`;
  }
  const m = Math.round(days / 30.4);
  return m <= 1 ? "every month" : `every ${m} months`;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The date to suggest: when it's due, but never sooner than 2 working days out. */
export function suggestDate(nextDue: string, today = todayCentral()): string {
  let soonest = today;
  let added = 0;
  while (added < 2) {
    soonest = addDays(soonest, 1);
    const wd = new Date(soonest + "T12:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  let d = nextDue > soonest ? nextDue : soonest;
  const wd = new Date(d + "T12:00:00Z").getUTCDay();
  if (wd === 6) d = addDays(d, 2);
  if (wd === 0) d = addDays(d, 1);
  return d;
}

export function dayName(iso: string, today = todayCentral()): string {
  const diff = dayDiff(iso, today);
  const d = new Date(iso + "T12:00:00Z");
  const wd = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (diff === 1) return `tomorrow (${md})`;
  if (diff > 1 && diff < 7) return `${wd} (${md})`;
  return `${wd}, ${md}`;
}

export async function usualItems(supabase: SupabaseClient, companyId: string): Promise<UsualItem[]> {
  const { data, error } = await supabase.rpc("reorder_suggestions", { p_company: companyId });
  if (error || !data?.length) return [];
  const rows = data as { product_id: string; times: number; usual_days: number; usual_qty: number; last_at: string; next_due: string }[];
  const { data: prods } = await supabase.from("products").select("id, name, unit, active").in("id", rows.map((r) => r.product_id));
  const byId = new Map(((prods ?? []) as { id: string; name: string; unit: string; active: boolean }[]).filter((p) => p.active).map((p) => [p.id, p]));
  const today = todayCentral();
  return rows
    .filter((r) => byId.has(r.product_id))
    .map((r) => {
      const p = byId.get(r.product_id)!;
      return {
        product_id: r.product_id,
        name: p.name,
        unit: p.unit,
        times: r.times,
        usual_days: Number(r.usual_days),
        usual_qty: Math.max(1, Math.round(Number(r.usual_qty) * 100) / 100),
        last_at: r.last_at,
        next_due: r.next_due,
        days_until: dayDiff(r.next_due, today),
      };
    })
    .sort((a, b) => a.days_until - b.days_until || b.times - a.times);
}

export type ReorderNudge = { lead: UsualItem; others: UsualItem[]; date: string; text: string };

/** The Home card: shown when something they usually order is due within a week (or overdue). */
export async function reorderNudge(supabase: SupabaseClient, companyId: string): Promise<ReorderNudge | null> {
  const items = await usualItems(supabase, companyId);
  const due = items.filter((i) => i.days_until <= 7);
  if (!due.length) return null;
  const lead = due[0];
  const date = suggestDate(lead.next_due);
  const text = `You usually order ${qtyText(lead.usual_qty, lead.unit)} of ${lead.name} ${rhythm(lead.usual_days)}.`;
  return { lead, others: due.slice(1), date, text };
}

/** A cart of their usual items (the ones due, or all of them) for the Order screen. */
export async function smartDraft(supabase: SupabaseClient, companyId: string, all: boolean, staff: boolean): Promise<OrderDraft | null> {
  const items = await usualItems(supabase, companyId);
  const pick = all ? items : items.filter((i) => i.days_until <= 7);
  if (!pick.length && !staff) return null;
  const cart: Record<string, number> = {};
  for (const i of pick) cart[i.product_id] = i.usual_qty;
  let branchId: string | null = null;
  if (staff) {
    const { data } = await supabase.from("companies").select("default_branch_id").eq("id", companyId).maybeSingle();
    branchId = (data?.default_branch_id as string | null) ?? null;
  }
  return {
    id: null,
    source: "smart",
    companyId: staff ? companyId : null,
    branchId,
    delivery: null,
    address: null,
    po: null,
    neededBy: pick.length ? suggestDate(pick[0].next_due) : null,
    notes: null,
    items: cart,
  };
}

export type DueCustomer = {
  company_id: string;
  company_name: string;
  orders: number;
  usual_days: number;
  last_at: string;
  days_since: number;
  days_over: number;
  last_order_id: string | null;
  phone: string | null;
  contact_name: string | null;
  account_no: string | null;
};

export async function customersDue(supabase: SupabaseClient, limit = 50): Promise<DueCustomer[] | null> {
  const { data, error } = await supabase.rpc("customers_due", { p_limit: limit });
  if (error) return null;
  return (data ?? []) as DueCustomer[];
}
