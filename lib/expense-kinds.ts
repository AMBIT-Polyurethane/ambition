import { todayCentral } from "@/lib/sale";

// Expense receipts, card charges and monthly reports (migration 0050): the shapes and small helpers that
// both the screens and the server use. The server-only parts are in lib/expenses.ts.

export const CATEGORIES = [
  "Fuel",
  "Meals",
  "Lodging",
  "Airfare & travel",
  "Vehicle & equipment repair",
  "Tools & supplies",
  "Shipping",
  "Customer entertainment",
  "Training & events",
  "Other",
] as const;

/** Meals and entertainment: who was there (the IRS asks), and the tip can be added after the receipt. */
export const PEOPLE_CATS = new Set<string>(["Meals", "Customer entertainment"]);
/** Travel, for the dashboard. */
export const TRAVEL_CATS = new Set<string>(["Fuel", "Lodging", "Airfare & travel"]);

export type XReceipt = {
  id: string;
  user_id: string;
  bought_on: string;
  vendor: string;
  amount: number;
  tip: number | null;
  category: string;
  paid_with: "card" | "personal";
  card_last4: string | null;
  company_id: string | null;
  customer_name: string | null;
  purpose: string | null;
  attendees: string | null;
  notes: string | null;
  photos: string[];
  no_photo_reason: string | null;
  source: "app" | "jotform";
  created_at: string;
};
export const RECEIPT_COLS =
  "id, user_id, bought_on, vendor, amount, tip, category, paid_with, card_last4, company_id, customer_name, purpose, attendees, notes, photos, no_photo_reason, source, created_at";

export type XCharge = {
  id: string;
  source: "upload" | "plaid";
  card_last4: string | null;
  user_id: string | null;
  txn_date: string;
  post_date: string | null;
  description: string;
  merchant: string | null;
  kind: "purchase" | "return" | "fee" | "payment" | "other";
  amount: number;
  receipt_id: string | null;
  match_how: "auto" | "manual" | null;
  excused_note: string | null;
  category: string | null;
};
export const CHARGE_COLS = "id, source, card_last4, user_id, txn_date, post_date, description, merchant, kind, amount, receipt_id, match_how, excused_note, category";

export type ReportStatus = "sent" | "submitted" | "approved" | "returned";
export type XReport = {
  id: string;
  user_id: string;
  month: string;
  status: ReportStatus;
  submitted_at: string | null;
  auto_submitted: boolean;
  sent_at: string;
  total: number;
  card_total: number;
  personal_total: number;
  receipt_count: number;
  charge_count: number;
  approved_by_name: string | null;
  approved_at: string | null;
  returned_at: string | null;
  review_note: string | null;
};
export const REPORT_COLS =
  "id, user_id, month, status, submitted_at, auto_submitted, sent_at, total, card_total, personal_total, receipt_count, charge_count, approved_by_name, approved_at, returned_at, review_note";

// ------------------------------------------------------------------ months
export const thisMonth = () => todayCentral().slice(0, 7);
export const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
/** First day of the month and the first day of the next one (YYYY-MM-DD). */
export const monthSpan = (m: string) => ({ from: `${m}-01`, next: `${shiftMonth(m, 1)}-01` });
export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const daysApart = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Who the receipt was for, in words. */
export const customerOf = (r: Pick<XReceipt, "customer_name">) => (r.customer_name ?? "").trim();

export type MonthView = {
  receipts: XReceipt[];
  charges: XCharge[];
  /** Card purchases with no receipt (and no "no receipt needed"). */
  missing: XCharge[];
  /** receipt id -> the card charge it's matched to */
  chargeFor: Map<string, XCharge>;
  /** Receipts marked "card" that no card charge has shown up for yet. */
  waiting: XReceipt[];
  /** Receipts not matched to any charge (any month nearby): what "Pick one I uploaded" offers. */
  loose: XReceipt[];
  totals: { total: number; card: number; personal: number; receipts: number; charges: number; matched: number; byCategory: { category: string; total: number; count: number }[] };
};

/**
 * One person's month, from their receipts (this month and a few days either side) and card charges.
 * Every dollar counts once: a matched receipt at what the bank charged, a card receipt the bank hasn't shown
 * at its own amount, a charge with no receipt at the bank's amount (the database does the same).
 */
export function monthView(month: string, nearby: XReceipt[], charges: XCharge[]): MonthView {
  const { from, next } = monthSpan(month);
  const inMonth = (d: string) => d >= from && d < next;
  const receipts = nearby.filter((r) => inMonth(r.bought_on)).sort((a, b) => b.bought_on.localeCompare(a.bought_on) || b.created_at.localeCompare(a.created_at));
  const mine = charges.filter((c) => c.kind !== "payment" && inMonth(c.txn_date)).sort((a, b) => b.txn_date.localeCompare(a.txn_date));
  const chargeFor = new Map<string, XCharge>();
  for (const c of charges) if (c.receipt_id) chargeFor.set(c.receipt_id, c);
  const missing = mine.filter((c) => c.kind === "purchase" && !c.receipt_id && !c.excused_note);
  const waiting = receipts.filter((r) => r.paid_with === "card" && !chargeFor.has(r.id));
  const loose = nearby.filter((r) => !chargeFor.has(r.id));

  const cats = new Map<string, { total: number; count: number }>();
  const add = (cat: string, a: number) => {
    const c = cats.get(cat) ?? { total: 0, count: 0 };
    c.total += a;
    c.count++;
    cats.set(cat, c);
  };
  let card = 0;
  let personal = 0;
  for (const r of receipts) {
    const c = chargeFor.get(r.id);
    if (c && c.kind !== "payment") continue; // counted with the charges below
    if (r.paid_with === "personal") personal += Number(r.amount);
    else card += Number(r.amount);
    add(r.category, Number(r.amount));
  }
  const byId = new Map(nearby.map((r) => [r.id, r]));
  for (const c of mine) {
    if (c.kind === "other") continue;
    card += Number(c.amount);
    const r = c.receipt_id ? byId.get(c.receipt_id) : null;
    add(r ? r.category : c.kind === "return" ? "Returns & credits" : c.kind === "fee" ? "Bank fees" : c.excused_note ? c.category ?? "Other" : "No receipt yet", Number(c.amount));
  }
  return {
    receipts,
    charges: mine,
    missing,
    chargeFor,
    waiting,
    loose,
    totals: {
      total: r2(card + personal),
      card: r2(card),
      personal: r2(personal),
      receipts: receipts.length,
      charges: mine.filter((c) => c.kind === "purchase").length,
      matched: mine.filter((c) => c.kind === "purchase" && c.receipt_id).length,
      byCategory: [...cats.entries()].map(([category, v]) => ({ category, total: r2(v.total), count: v.count })).sort((a, b) => b.total - a.total),
    },
  };
}

export function reportBadge(r: Pick<XReport, "status" | "approved_by_name"> | null | undefined): { text: string; tone: "ok" | "warn" | "info" | "grey" } {
  if (!r) return { text: "Not sent", tone: "grey" };
  if (r.status === "approved") return { text: r.approved_by_name ? `Approved by ${r.approved_by_name.split(" ")[0]}` : "Approved", tone: "ok" };
  if (r.status === "submitted") return { text: "Waiting for approval", tone: "info" };
  if (r.status === "returned") return { text: "Sent back", tone: "warn" };
  return { text: "Emailed (old way)", tone: "grey" };
}

export const receiptPhotoHref = (id: string, i = 0, w?: number) => `/expenses/file?r=${id}&i=${i}${w ? `&w=${w}` : ""}`;
export const chargeLabel = (c: Pick<XCharge, "merchant" | "description">) => (c.merchant || c.description || "Card charge").trim();

/** The dashboard's date choices. */
export type PeriodKey = "month" | "last" | "q" | "ytd" | "12m" | "custom";
export const PERIODS: [PeriodKey, string][] = [
  ["month", "This month"],
  ["last", "Last month"],
  ["q", "Last 3 months"],
  ["ytd", "This year"],
  ["12m", "Last 12 months"],
  ["custom", "Pick dates"],
];
