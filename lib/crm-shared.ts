// Sales CRM (0109): the shapes and words the screens share (safe for the browser too).

export type Health = "new" | "healthy" | "watch" | "at_risk" | "inactive" | "no_history";

export type CrmCustomer = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  rep_id: string | null;
  rep_name: string | null;
  house: boolean;
  phone: string | null;
  email: string | null;
  contact: string | null;
  first_day: string | null;
  last_day: string | null;
  days_since: number | null;
  usual_gap: number | null;
  orders_12m: number;
  sales_12m: number;
  sales_90d: number;
  sales_prev_90d: number;
  sales_mtd: number;
  monthly: number[];
  status: Health;
};

export const HEALTH: Record<Health, { label: string; pill: string; hint: string; rank: number }> = {
  at_risk: { label: "At risk", pill: "red", hint: "Well past the time they usually reorder", rank: 0 },
  watch: { label: "Watch", pill: "warn", hint: "Past their usual time, or spending less than the 3 months before", rank: 1 },
  new: { label: "New", pill: "info", hint: "First order in the last 60 days", rank: 2 },
  healthy: { label: "Healthy", pill: "ok", hint: "Ordering on their usual rhythm", rank: 3 },
  inactive: { label: "Inactive", pill: "grey", hint: "Nothing in 6 months", rank: 4 },
  no_history: { label: "No orders yet", pill: "grey", hint: "No sales on file", rank: 5 },
};

export type LeadStage = "lead" | "app_sent" | "credit_review" | "approved" | "first_order" | "repeat" | "lost";
export const STAGES: { key: LeadStage; label: string; hint: string }[] = [
  { key: "lead", label: "Lead", hint: "Met them, got a name and number" },
  { key: "app_sent", label: "Credit app sent", hint: "Waiting for them to fill it in" },
  { key: "credit_review", label: "Credit review", hint: "Accounting is checking it" },
  { key: "approved", label: "Approved", hint: "Ready for a first order" },
  { key: "first_order", label: "First order", hint: "Ordered once. Make the second one easy" },
  { key: "repeat", label: "Repeat customer", hint: "Second order placed: now one of My customers" },
];

export type Lead = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  size_note: string | null;
  source: string | null;
  stage: LeadStage;
  rep_id: string | null;
  rep_name: string | null;
  company_id: string | null;
  company_name: string | null;
  notes: string | null;
  lost_reason: string | null;
  stage_at: string;
  days_in_stage: number;
  orders: number;
  created_at: string;
};

export type Activity = { id: number; company_id: string | null; lead_id: string | null; kind: string; body: string; created_by_name: string | null; occurred_at: string };
export type Task = { id: number; company_id: string | null; lead_id: string | null; title: string; due_on: string | null; assigned_name: string | null; source: string; done_at: string | null; created_by_name: string | null };

export const KINDS: { key: string; label: string }[] = [
  { key: "call", label: "Call" },
  { key: "visit", label: "Visit" },
  { key: "text", label: "Text" },
  { key: "email", label: "Email" },
  { key: "meeting", label: "Meeting" },
  { key: "note", label: "Note" },
];

/** $12.4k, $1.2M: short money for tiles and tables. */
export function kmoney(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  const a = Math.abs(n);
  const trim = (x: string) => x.replace(/\.0$/, "");
  if (a >= 1_000_000) return `${n < 0 ? "-" : ""}$${trim((a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1))}M`;
  if (a >= 10_000) return `${n < 0 ? "-" : ""}$${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${n < 0 ? "-" : ""}$${trim((a / 1000).toFixed(1))}k`;
  return `${n < 0 ? "-" : ""}$${Math.round(a)}`;
}

/** "12 days", "3 months": how long since. */
export function sinceText(days: number | null | undefined): string {
  if (days === null || days === undefined) return "Never";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 60) return `${days} days ago`;
  const m = Math.round(days / 30.4);
  return m < 24 ? `${m} months ago` : `${Math.round(days / 365)} years ago`;
}

/** The 12 month labels ending this month ("Dec" … "Nov"). */
export function monthLabels(): string[] {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1).toLocaleDateString("en-US", { month: "short" }));
}
