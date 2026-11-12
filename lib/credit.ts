import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { can } from "@/lib/access";

// Customer credit (0066): each customer's credit line, the balance and aging imported from QuickBooks, plus what
// shipped since (adds) and payments the CRMs enter (comes off, oldest past due first). Used by Credit & collections,
// each customer's credit page, and the credit check on the order desk.

export type CreditRow = {
  company_id: string; name: string; account_no: string | null; branch: string | null; rep_id: string | null;
  credit_limit: number | null; terms: string | null; as_of: string | null;
  imported: number; shipped_since: number; paid_since: number; balance: number; past_due: number;
  over_90: number; d61_90: number; d31_60: number; d1_30: number; current_due: number;
  available: number | null; last_paid: string | null; last_paid_amount: number | null; paid_90: number;
  orders_open: number; holds: number; pay_cod: boolean; next_follow: string | null;
};

export const canCredit = (p: Pick<Profile, "role" | "status"> & { perms?: string[] | null }) => p.role === "admin" || can(p, "credit_check") || can(p, "order_desk");
export const canSetCredit = (p: Pick<Profile, "role" | "status"> & { perms?: string[] | null }) => p.role === "admin" || can(p, "credit_check");

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
function clean(r: Record<string, unknown>): CreditRow {
  return {
    ...(r as unknown as CreditRow),
    credit_limit: r.credit_limit === null ? null : num(r.credit_limit),
    available: r.available === null ? null : num(r.available),
    last_paid_amount: r.last_paid_amount === null ? null : num(r.last_paid_amount),
    imported: num(r.imported), shipped_since: num(r.shipped_since), paid_since: num(r.paid_since), balance: num(r.balance), past_due: num(r.past_due),
    over_90: num(r.over_90), d61_90: num(r.d61_90), d31_60: num(r.d31_60), d1_30: num(r.d1_30), current_due: num(r.current_due), paid_90: num(r.paid_90),
    orders_open: num(r.orders_open), holds: num(r.holds),
  };
}

/** Every customer with credit on file (or { ready: false } before 0066). */
export async function creditOverview(db: SupabaseClient): Promise<{ ready: boolean; rows: CreditRow[] }> {
  const { data, error } = await db.rpc("credit_overview");
  if (error) return { ready: !/credit_overview|function|schema cache/i.test(error.message), rows: [] };
  return { ready: true, rows: ((data ?? []) as Record<string, unknown>[]).map(clean) };
}

/** One customer's credit right now (null if none on file). */
export async function creditFor(db: SupabaseClient, companyId: string): Promise<CreditRow | null> {
  const { data, error } = await db.rpc("credit_overview").eq("company_id", companyId).maybeSingle();
  if (error || !data) return null;
  return clean(data as Record<string, unknown>);
}

/** How healthy an account looks, for the badges: 90+ or over the limit is red, past due is amber. */
export function health(r: Pick<CreditRow, "over_90" | "past_due" | "available" | "balance" | "credit_limit">): { label: string; pill: string; score: number } {
  if (r.over_90 > 0) return { label: "90+ days", pill: "pill red", score: 3 };
  if (r.available !== null && r.available < 0) return { label: "Over limit", pill: "pill red", score: 3 };
  if (r.past_due > 0) return { label: "Past due", pill: "pill warn", score: 2 };
  if (r.credit_limit && r.balance > r.credit_limit * 0.85) return { label: "Near limit", pill: "pill warn", score: 1 };
  return { label: "Current", pill: "pill ok", score: 0 };
}
