import "server-only";
import type { Answer, Submission } from "@/lib/jotform";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHARGE_COLS, REPORT_COLS, RECEIPT_COLS, addDays, chargeLabel, isMonth, monthSpan, monthView, type XCharge, type XReceipt, type XReport } from "@/lib/expense-kinds";
import { expensePdfName, renderExpensePdf, type PdfLine } from "@/lib/expense-doc/pdf";
import { demoReceiptJpeg, isDemoPhoto } from "@/lib/expense-demo";

export * from "@/lib/expense-kinds";

// Employee expenses. Receipts are saved in the app (migration 0050); card charges come from the Chase
// statement (or the bank link) and are matched to them. Receipts used to be submissions of the "AMBIT
// Expense Receipt" Jotform form: the Jotform reading below is what brings those old ones over.

export const EXPENSE_FORM_ID = (process.env.EXPENSE_FORM_ID || "262964802280965").trim();
export const expensesReady = () => /^\d{6,25}$/.test(EXPENSE_FORM_ID) && Boolean(process.env.JOTFORM_API_KEY?.trim());

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

// ------------------------------------------------------------------ the app's own receipts (0050)

/** One person's month: their receipts (and nearby ones, for matching by hand), card charges and the report. */
export async function loadMonth(supabase: SupabaseClient, userId: string, month: string) {
  if (!isMonth(month)) throw new Error("Pick a month.");
  const { from, next } = monthSpan(month);
  const [rec, chg, rep] = await Promise.all([
    supabase.from("expense_receipts").select(RECEIPT_COLS).eq("user_id", userId).is("deleted_at", null).gte("bought_on", addDays(from, -10)).lt("bought_on", addDays(next, 10)).limit(2000),
    supabase.from("expense_charges").select(CHARGE_COLS).eq("user_id", userId).eq("removed", false).gte("txn_date", addDays(from, -10)).lt("txn_date", addDays(next, 10)).limit(2000),
    supabase.from("expense_reports").select(REPORT_COLS).eq("user_id", userId).eq("month", from).maybeSingle(),
  ]);
  if (rec.error) throw new Error(rec.error.message);
  const receipts = ((rec.data ?? []) as XReceipt[]).map((r) => ({ ...r, amount: Number(r.amount), tip: r.tip === null ? null : Number(r.tip) }));
  const charges = ((chg.data ?? []) as XCharge[]).map((c) => ({ ...c, amount: Number(c.amount) }));
  const report = (rep.data as XReport | null) ?? null;
  return { view: monthView(month, receipts, charges), report };
}

/** The report's lines: every receipt, and every card charge without one (returns, fees, "no receipt needed"). */
export function pdfLines(view: ReturnType<typeof monthView>): PdfLine[] {
  const out: PdfLine[] = [];
  for (const r of view.receipts) {
    const c = view.chargeFor.get(r.id);
    const cust = (r.customer_name ?? "").trim();
    out.push({
      id: r.id,
      date: r.bought_on,
      vendor: r.vendor,
      category: r.category,
      what: [cust ? `For ${cust}` : "", r.purpose ?? "", r.attendees ? `With ${r.attendees}` : ""].filter(Boolean).join(" · "),
      paid: r.paid_with === "personal" ? "Personal" : "Card",
      amount: c ? Number(c.amount) : Number(r.amount),
      photos: r.photos,
      noPhoto: r.photos.length ? null : r.no_photo_reason || "none was uploaded",
    });
  }
  for (const c of view.charges) {
    if (c.receipt_id || c.kind === "other") continue;
    out.push({
      id: c.id,
      date: c.txn_date,
      vendor: chargeLabel(c),
      category: c.kind === "return" ? "Returns & credits" : c.kind === "fee" ? "Bank fees" : c.excused_note ? c.category ?? "Other" : "No receipt",
      what: c.kind === "purchase" ? (c.excused_note ? `No receipt needed: ${c.excused_note}` : "No receipt yet") : c.description,
      paid: "Card",
      amount: Number(c.amount),
      photos: [],
    });
  }
  return out;
}

/** One person's monthly report as a PDF (photos read with whichever login is given). */
export async function expensePdf(supabase: SupabaseClient, who: { id: string; name: string; email: string }, month: string) {
  const { view, report } = await loadMonth(supabase, who.id, month);
  const status = report
    ? report.status === "approved"
      ? { kind: "approved" as const, by: report.approved_by_name, at: report.approved_at, note: report.review_note }
      : report.status === "submitted"
        ? { kind: "submitted" as const, at: report.submitted_at }
        : report.status === "returned"
          ? { kind: "returned" as const, note: report.review_note }
          : null
    : null;
  const pdf = await renderExpensePdf({
    name: who.name,
    email: who.email,
    month,
    lines: pdfLines(view),
    totals: view.totals,
    byCategory: view.totals.byCategory,
    status,
    loadPhoto: async (key) => {
      if (isDemoPhoto(key)) {
        const r = view.receipts.find((x) => `demo:${x.id}` === key);
        const c = r ? view.chargeFor.get(r.id) : undefined;
        return r ? demoReceiptJpeg(r, { chargedMore: Boolean(c && Number(c.amount) > Number(r.amount) + 0.004), width: 1000 }) : null;
      }
      const { data } = await supabase.storage.from("receipts").download(key);
      return data ? Buffer.from(await data.arrayBuffer()) : null;
    },
  });
  return { pdf, filename: expensePdfName(who.name, month), view, report };
}
