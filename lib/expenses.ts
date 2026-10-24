import "server-only";
import { api, JOTFORM_SITE, type Answer, type Submission } from "@/lib/jotform";
import { todayCentral } from "@/lib/sale";

// Employee expenses. Each receipt is one submission of the "AMBIT Expense Receipt" Jotform form
// (a photo of the receipt plus date, store, amount and category). The app reads them back to build
// each person's monthly expense report. Vercel settings (optional): EXPENSE_FORM_ID, EXPENSE_REPORT_TO.

export const EXPENSE_FORM_ID = (process.env.EXPENSE_FORM_ID || "262964802280965").trim();
export const expensesReady = () => /^\d{6,25}$/.test(EXPENSE_FORM_ID) && Boolean(process.env.JOTFORM_API_KEY?.trim());

/** Who gets the monthly reports ("Corporate"). */
export const REPORT_TO = (process.env.EXPENSE_REPORT_TO || "jeremiah.bryant@ambitpu.com, kim.hight@ambitpu.com, kevin.lall@ambitpu.com")
  .split(/[,;\s]+/)
  .map((e) => e.trim().toLowerCase())
  .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

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

export type Receipt = {
  id: string;
  created_at: string;
  email: string;
  name: string;
  /** Purchase date, YYYY-MM-DD (the upload day when the date is missing). */
  date: string;
  vendor: string;
  amount: number | null;
  category: string;
  purpose: string;
  /** "card" = AMBIT company card, "personal" = paid personally, to be paid back. */
  paidWith: "card" | "personal";
  notes: string;
  files: string[];
};

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

// ------------------------------------------------------------------ answers
const label = (a: Answer) => `${a.text ?? ""}`.toLowerCase();
function pick(s: Submission, names: string[], test?: RegExp): Answer | undefined {
  const list = Object.values(s.answers ?? {});
  return list.find((a) => a.name && names.includes(a.name)) ?? (test ? list.find((a) => test.test(label(a))) : undefined);
}
function text(a: Answer | undefined): string {
  if (!a) return "";
  const v = a.answer;
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, string>;
    if ("first" in o || "last" in o) return [o.first, o.last].filter(Boolean).join(" ").trim();
  }
  return (a.prettyFormat ?? "").toString().replace(/<[^>]+>/g, "").trim();
}
function day(a: Answer | undefined): string | null {
  if (!a) return null;
  const v = a.answer as Record<string, string> | string | undefined;
  if (v && typeof v === "object") {
    if (v.year && v.month && v.day) return `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}`;
    if (v.datetime) return String(v.datetime).slice(0, 10);
  }
  const t = typeof v === "string" ? v : a.prettyFormat ?? "";
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}
export function parseMoney(t: string): number | null {
  const m = t.replace(/[,\s$]/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Math.round(Number(m[0]) * 100) / 100;
  return Number.isFinite(n) ? n : null;
}

export function toReceipt(s: Submission): Receipt {
  const files = pick(s, ["receipt", "receiptPhoto"], /receipt|photo|upload/)?.answer;
  const paid = text(pick(s, ["paidWith"], /paid with|payment/));
  return {
    id: String(s.id),
    created_at: s.created_at,
    email: text(pick(s, ["email"], /e-?mail/)).toLowerCase(),
    name: text(pick(s, ["name", "employee"], /name|employee/)),
    date: day(pick(s, ["purchaseDate", "date"], /date/)) ?? s.created_at.slice(0, 10),
    vendor: text(pick(s, ["vendor", "store"], /vendor|store|merchant/)),
    amount: parseMoney(text(pick(s, ["amount", "total"], /amount|total/))),
    category: text(pick(s, ["category"], /category/)) || "Other",
    purpose: text(pick(s, ["purpose"], /what was it for|purpose|job/)),
    paidWith: /personal|reimburse|own/i.test(paid) ? "personal" : "card",
    notes: text(pick(s, ["notes"], /note/)),
    files: Array.isArray(files) ? files.filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u)) : [],
  };
}

/**
 * Receipts with a purchase date in this month (newest first), for one person or everyone.
 * Receipts uploaded late (next month) still land on the month they were bought.
 */
export async function receiptsFor(month: string, email?: string): Promise<Receipt[]> {
  if (!expensesReady() || !isMonth(month)) return [];
  // Anything bought this month was uploaded on or after the 1st (a few days' slack for typos).
  const from = new Date(`${month}-01T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 5);
  const filter = encodeURIComponent(JSON.stringify({ "status:ne": "DELETED", "created_at:gt": from.toISOString().slice(0, 19).replace("T", " ") }));
  const all: Submission[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const page = await api<Submission[]>(`/form/${EXPENSE_FORM_ID}/submissions?limit=1000&offset=${offset}&orderby=created_at&filter=${filter}`, false);
    all.push(...(page ?? []).filter((s) => s.status !== "DELETED"));
    if (!page || page.length < 1000) break;
  }
  const who = email?.toLowerCase();
  return all
    .map(toReceipt)
    .filter((r) => r.date.startsWith(month) && (!who || r.email === who))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
}

/** One receipt (for showing its photo), or null if it's not on the expense form. */
export async function receiptById(id: string): Promise<Receipt | null> {
  if (!expensesReady() || !/^\d{6,25}$/.test(id)) return null;
  try {
    const s = await api<Submission>(`/submission/${id}`, false);
    if (!s || String(s.form_id) !== EXPENSE_FORM_ID || s.status === "DELETED") return null;
    return toReceipt(s);
  } catch {
    return null;
  }
}

export type Totals = { total: number; card: number; personal: number; count: number; missing: number; byCategory: { category: string; total: number; count: number }[] };

export function totals(list: Receipt[]): Totals {
  const cats = new Map<string, { total: number; count: number }>();
  let total = 0,
    card = 0,
    personal = 0,
    missing = 0;
  for (const r of list) {
    const a = r.amount ?? 0;
    if (r.amount === null) missing++;
    total += a;
    if (r.paidWith === "personal") personal += a;
    else card += a;
    const c = cats.get(r.category) ?? { total: 0, count: 0 };
    c.total += a;
    c.count++;
    cats.set(r.category, c);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    total: round(total),
    card: round(card),
    personal: round(personal),
    count: list.length,
    missing,
    byCategory: [...cats.entries()].map(([category, v]) => ({ category, total: round(v.total), count: v.count })).sort((a, b) => b.total - a.total),
  };
}

/** The receipt form, filled in with who's signed in (Jotform fills fields whose name matches). */
export function receiptFormUrl(p: { full_name: string | null; email: string }): string {
  const u = new URL(`${JOTFORM_SITE}/${EXPENSE_FORM_ID}`);
  const full = (p.full_name ?? "").trim();
  if (full) {
    const parts = full.split(/\s+/);
    const last = parts.length > 1 ? parts.pop()! : "";
    u.searchParams.set("name[first]", parts.join(" "));
    if (last) u.searchParams.set("name[last]", last);
  }
  u.searchParams.set("email", p.email.toLowerCase());
  return u.toString();
}

export const receiptFileHref = (r: Pick<Receipt, "id">, i = 0, w?: number) => `/expenses/file?s=${r.id}&i=${i}${w ? `&w=${w}` : ""}`;
