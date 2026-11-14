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
  // 0068: credit status, shared lines (MacArthur), open invoices
  status: CreditStatus | null; parent_id: string | null; flags: string[]; limit_prior: number | null; manual: boolean;
  group_limit: number | null; group_balance: number; group_open: number; group_available: number | null; group_past_due: number;
  open_invoices: number; oldest_due: string | null; max_days_late: number | null;
};

export type CreditStatus = "line" | "revoked" | "advance" | "review";
/** The tag on every customer: Has Line Of Credit, Credit Line Revoked, Pays in advance, Credit review. */
export const STATUS: Record<CreditStatus, { label: string; short: string; pill: string; hint: string }> = {
  line: { label: "Has Line Of Credit", short: "Line of credit", pill: "pill ok", hint: "Orders can release automatically when nothing is past due and the order fits the line." },
  revoked: { label: "Credit Line Revoked", short: "Revoked", pill: "pill red", hint: "Pays in advance until Accounting reinstates the line." },
  advance: { label: "Pays in advance", short: "Advance", pill: "pill", hint: "No credit line: cash, card, wire or certified check before release." },
  review: { label: "Credit review", short: "In review", pill: "pill warn", hint: "Credit application in progress. Accounting releases each order by hand." },
};
export const FLAGS: Record<string, string> = { collections: "In collections", payment_plan: "Payment plan", high_risk: "High risk", tax_issue: "Tax certificate issue" };

/** Every way money (or a credit) comes in or goes out. kind: payment (money in), credit (no money), refund (money out). */
export const METHODS = [
  { key: "check", label: "Check", kind: "payment", ref: "Check #" },
  { key: "ach", label: "ACH", kind: "payment", ref: "Trace / confirmation #" },
  { key: "wire", label: "Wire", kind: "payment", ref: "Wire reference" },
  { key: "card", label: "Credit card", kind: "payment", ref: "Approval code" },
  { key: "debit", label: "Debit card", kind: "payment", ref: "Approval code" },
  { key: "cash", label: "Cash", kind: "payment", ref: "Receipt #" },
  { key: "zelle", label: "Zelle", kind: "payment", ref: "Confirmation #" },
  { key: "money_order", label: "Money order", kind: "payment", ref: "Money order #" },
  { key: "cashiers_check", label: "Cashier's check", kind: "payment", ref: "Check #" },
  { key: "account_credit", label: "Account credit", kind: "credit", ref: "Credit memo #" },
  { key: "write_off", label: "Write-off", kind: "credit", ref: "Reference" },
  { key: "other", label: "Other", kind: "payment", ref: "Reference" },
] as const;
export type MethodKey = (typeof METHODS)[number]["key"] | "discount";
export const methodLabel = (m: string, kind?: string) => (kind === "refund" ? "Refund · " : "") + (METHODS.find((x) => x.key === m)?.label ?? (m === "discount" ? "Early-pay discount" : m));

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
    limit_prior: r.limit_prior === null || r.limit_prior === undefined ? null : num(r.limit_prior),
    group_limit: r.group_limit === null || r.group_limit === undefined ? null : num(r.group_limit),
    group_available: r.group_available === null || r.group_available === undefined ? null : num(r.group_available),
    group_balance: num(r.group_balance), group_open: num(r.group_open), group_past_due: num(r.group_past_due), open_invoices: num(r.open_invoices),
    max_days_late: r.max_days_late === null || r.max_days_late === undefined ? null : num(r.max_days_late),
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : [], manual: Boolean(r.manual),
    status: (r.status as CreditStatus | null) ?? null,
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
  if (r.balance < -0.004) return { label: "Credit on account", pill: "pill ok", score: 0 };
  if (r.available !== null && r.available < 0) return { label: "Over limit", pill: "pill red", score: 3 };
  if (r.past_due > 0) return { label: "Past due", pill: "pill warn", score: 2 };
  if (r.credit_limit && r.balance > r.credit_limit * 0.85) return { label: "Near limit", pill: "pill warn", score: 1 };
  return { label: "Current", pill: "pill ok", score: 0 };
}

export type Invoice = {
  id: number; company_id: string; kind: string; doc_no: string | null; txn_date: string; due_date: string | null; amount: number; open_balance: number;
  location: string | null; branch_id: string | null; qb_name: string | null; as_of: string; status: string;
};
/** Days past the due date (negative = not due yet), Central time. */
export function daysLate(due: string | null, today: string): number {
  if (!due) return 0;
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86400000);
}
export const lateClass = (d: number) => (d > 90 ? "red" : d > 30 ? "red" : d > 0 ? "warn-text" : "");
