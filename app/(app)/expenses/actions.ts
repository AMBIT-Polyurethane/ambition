"use server";

import { revalidatePath } from "next/cache";
import type Anthropic from "@anthropic-ai/sdk";
import { requireEmployee } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { claudeReady, costCents, fillForm, friendlyClaudeError } from "@/lib/ai/claude";
import { DEFAULT_MODEL } from "@/lib/assistant/config";
import { shrinkImage } from "@/lib/image-shrink";
import { todayCentral } from "@/lib/sale";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { CATEGORIES, PEOPLE_CATS, isMonth, loadMonth, monthLabel } from "@/lib/expenses";
import { mailSubmitted, type Submitted } from "@/lib/expense-mail";
import { money } from "@/lib/format";

// Saving receipts and sending a month for approval. Everything is saved with the person's own login, so the
// database's rules decide (their own receipts only; a month that's waiting or approved is locked).

const t = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cents = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// ------------------------------------------------------------------ AI read

export type ReceiptRead = {
  vendor: string | null;
  date: string | null;
  total: number | null;
  tip: number | null;
  tip_blank: boolean;
  category: string | null;
  card_last4: string | null;
  summary: string | null;
  note: string | null;
};

const FORM = {
  name: "read_receipt",
  description: "What the receipt says.",
  schema: {
    type: "object",
    properties: {
      vendor: { type: "string", description: "The business name as a person would say it (e.g. \"Love's\", \"Hampton Inn Amarillo\"). Empty if unreadable." },
      date: { type: "string", description: "Purchase date, YYYY-MM-DD. Empty if not shown." },
      total: { type: "number", description: "The final amount paid, tip included when a tip is written in. 0 if unreadable." },
      tip: { type: "number", description: "The tip written or printed on the receipt. 0 if none." },
      tip_blank: { type: "boolean", description: "True when there's a tip line left blank (the card will be charged more than the total)." },
      category: { type: "string", enum: [...CATEGORIES] },
      card_last4: { type: "string", description: "Last 4 digits of the card used, if printed (e.g. XXXX1234). Empty if not shown." },
      summary: { type: "string", description: "A few words on what was bought, e.g. \"Lunch for 3\", \"Diesel 24 gal\", \"2 nights\"." },
      note: { type: "string", description: "Anything unclear (faded, cut off, two totals). Empty if all clear." },
    },
    required: ["vendor", "date", "total", "tip", "tip_blank", "category", "card_last4", "summary", "note"],
  } as Record<string, unknown>,
};

/** Reads the receipt photo(s) the person just uploaded (their own folder in the receipts bucket). */
export async function readReceipt(paths: string[]): Promise<{ ok: true; read: ReceiptRead; cents: number } | { ok: false; error: string }> {
  const { supabase, profile } = await requireEmployee();
  if (!claudeReady()) return { ok: false, error: "The AI read isn't set up. Fill it in yourself." };
  const mine = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p.startsWith(`${profile.id}/`) && !p.includes("..")).slice(0, 3);
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (const p of mine) {
    const { data } = await supabase.storage.from("receipts").download(p);
    if (!data) continue;
    const buf = Buffer.from(await data.arrayBuffer());
    if (/\.pdf$/i.test(p)) {
      if (buf.length < 8 * 1024 * 1024) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } });
      continue;
    }
    const small = await shrinkImage(buf, 1568, 82);
    if (small) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.body.toString("base64") } });
  }
  if (!content.length) return { ok: false, error: "Couldn't open that photo. Fill it in yourself." };
  content.push({ type: "text", text: "Read this receipt." });
  try {
    const { data, usage } = await fillForm<Record<string, unknown>>({
      model: DEFAULT_MODEL,
      maxTokens: 800,
      system: `You read store and restaurant receipts for AMBIT Polyurethane's employee expense reports. Read only what's printed or written; leave a field empty (or 0) if you can't read it. Today is ${todayCentral()} (receipts are from the last few weeks, almost never the future). Categories: Fuel (gas, diesel), Meals (food the employee bought, alone or with coworkers), Customer entertainment (meals or outings with customers), Lodging, Airfare & travel (flights, rental cars, rideshare, parking, tolls), Vehicle & equipment repair, Tools & supplies, Shipping, Training & events, Other. Restaurants: pick Meals unless the receipt clearly shows a customer outing.`,
      content,
      ...FORM,
    });
    const s = (k: string, max: number) => (typeof data[k] === "string" && (data[k] as string).trim() ? (data[k] as string).trim().slice(0, max) : null);
    const date = s("date", 10);
    const total = cents(data.total);
    const tip = cents(data.tip);
    const cat = s("category", 40);
    const last4 = (s("card_last4", 30) ?? "").replace(/\D/g, "").slice(-4);
    return {
      ok: true,
      cents: costCents(DEFAULT_MODEL, usage),
      read: {
        vendor: s("vendor", 80),
        date: date && DAY.test(date) && date <= todayCentral() ? date : null,
        total: total && total > 0 ? total : null,
        tip: tip && tip > 0 ? tip : null,
        tip_blank: data.tip_blank === true,
        category: cat && (CATEGORIES as readonly string[]).includes(cat) ? cat : null,
        card_last4: last4.length === 4 ? last4 : null,
        summary: s("summary", 120),
        note: s("note", 200),
      },
    };
  } catch (e) {
    return { ok: false, error: friendlyClaudeError(e) };
  }
}

// ------------------------------------------------------------------ save

export type ReceiptInput = {
  id?: string | null;
  bought_on: string;
  vendor: string;
  amount: number | string;
  tip?: number | string | null;
  category: string;
  paid_with: "card" | "personal";
  card_last4?: string | null;
  company_id?: string | null;
  customer_name?: string | null;
  purpose?: string | null;
  attendees?: string | null;
  notes?: string | null;
  photos: string[];
  no_photo_reason?: string | null;
  ai?: unknown;
  /** Made from a card charge ("Add receipt" next to it): link the two. */
  charge_id?: string | null;
};

export type SaveResult = { ok: true; id: string; month: string; matched: { day: string; amount: number; label: string } | null } | { ok: false; error: string };

export async function saveReceipt(d: ReceiptInput): Promise<SaveResult> {
  const { supabase, profile } = await requireEmployee();
  const day = t(d.bought_on, 10);
  if (!day || !DAY.test(day)) return { ok: false, error: "Pick the date it was bought." };
  if (day > todayCentral()) return { ok: false, error: "The date can't be in the future." };
  const amount = cents(d.amount);
  if (amount === null || amount <= 0) return { ok: false, error: "Type the total you paid." };
  if (amount > 50000) return { ok: false, error: "That total looks too big. Check it." };
  const vendor = t(d.vendor, 80);
  if (!vendor) return { ok: false, error: "Type where it was bought." };
  const category = (CATEGORIES as readonly string[]).includes(d.category) ? d.category : "Other";
  const tip = d.tip === null || d.tip === undefined || d.tip === "" ? null : cents(d.tip);
  const reason = t(d.no_photo_reason, 300);

  let existing: { id: string; user_id: string; photos: string[] } | null = null;
  if (d.id) {
    const { data } = await supabase.from("expense_receipts").select("id, user_id, photos").eq("id", d.id).is("deleted_at", null).maybeSingle();
    if (!data) return { ok: false, error: "That receipt wasn't found." };
    existing = data as { id: string; user_id: string; photos: string[] };
  }
  const owner = existing?.user_id ?? profile.id;
  // Photos: the owner's own uploads, plus whatever was already on the receipt (an approver fixing it).
  const photos = (Array.isArray(d.photos) ? d.photos : [])
    .filter((p) => typeof p === "string" && !p.includes("..") && (p.startsWith(`${profile.id}/`) || existing?.photos.includes(p)))
    .slice(0, 6);
  if (!photos.length && !reason) return { ok: false, error: "Add a photo of the receipt, or tap Lost receipt and say why there isn't one." };

  // The customer: one from the customer list (its name is saved with it), or a name typed in.
  let companyId = t(d.company_id, 40);
  let customer = t(d.customer_name, 120);
  if (companyId) {
    const { data: co } = await supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle();
    if (co) customer = co.name as string;
    else companyId = null;
  }
  const people = PEOPLE_CATS.has(category) ? t(d.attendees, 300) : null;
  if (category === "Customer entertainment" && !customer) return { ok: false, error: "Customer entertainment: pick the customer it was for." };

  const row = {
    bought_on: day,
    vendor,
    amount,
    tip: tip && tip > 0 ? tip : null,
    category,
    paid_with: d.paid_with === "personal" ? "personal" : "card",
    card_last4: d.paid_with === "personal" ? null : (t(d.card_last4, 8) ?? "").replace(/\D/g, "").slice(-4) || null,
    company_id: companyId,
    customer_name: customer,
    purpose: t(d.purpose, 300),
    attendees: people,
    notes: t(d.notes, 1000),
    photos,
    no_photo_reason: photos.length ? null : reason,
    ...(d.ai && typeof d.ai === "object" ? { ai: d.ai } : {}),
  };

  let id = existing?.id ?? null;
  if (existing) {
    const { error } = await supabase.from("expense_receipts").update(row).eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase.from("expense_receipts").insert({ ...row, user_id: profile.id }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Couldn't save the receipt." };
    id = data.id as string;
  }

  // Match it to its card charge: the one it was added from, or the closest fit.
  if (d.charge_id) {
    const { error } = await supabase.rpc("expense_link", { p_charge: d.charge_id, p_receipt: id });
    if (error) return { ok: false, error: `Saved, but couldn't attach it to that card charge: ${error.message}` };
  } else if (row.paid_with === "card") {
    await supabase.rpc("expense_auto_match", { p_user: owner === profile.id ? profile.id : owner });
  }
  const { data: m } = await supabase.from("expense_charges").select("txn_date, amount, merchant, description").eq("receipt_id", id).maybeSingle();
  revalidatePath("/expenses");
  return {
    ok: true,
    id: id!,
    month: day.slice(0, 7),
    matched: m ? { day: m.txn_date as string, amount: Number(m.amount), label: ((m.merchant as string) || (m.description as string) || "").trim() } : null,
  };
}

export async function deleteReceipt(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireEmployee();
  const { data: r } = await supabase.from("expense_receipts").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!r) return { ok: false, error: "That receipt wasn't found." };
  const { data: linked } = await supabase.from("expense_charges").select("id").eq("receipt_id", id);
  for (const c of (linked ?? []) as { id: string }[]) {
    const { error } = await supabase.rpc("expense_link", { p_charge: c.id, p_receipt: null });
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await supabase.from("expense_receipts").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/expenses");
  return { ok: true };
}

/** "This is the receipt for that charge" (or, with no receipt, undo a match). */
export async function linkCharge(chargeId: string, receiptId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("expense_link", { p_charge: chargeId, p_receipt: receiptId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/expenses");
  revalidatePath("/admin/expenses");
  return { ok: true };
}

// ------------------------------------------------------------------ send for approval

export type SubmitState = { ok?: string; warn?: string; error?: string } | null;

export async function submitMonth(_prev: SubmitState, form: FormData): Promise<SubmitState> {
  const { supabase, profile } = await requireEmployee();
  const month = String(form.get("month") ?? "");
  if (!isMonth(month)) return { error: "Pick a month first." };
  const { data, error } = await supabase.rpc("expense_submit", { p_month: `${month}-01` });
  if (error) return { error: error.message };
  const s = { ...(data as Omit<Submitted, "userId">), userId: profile.id };
  const { view } = await loadMonth(supabase, profile.id, month);
  const res = await mailSubmitted(s, view, await currentOrigin());
  if (serviceReady()) {
    await serviceClient()
      .from("expense_reports")
      .update({ email_status: res.status, sent_to: s.approvers.map((a) => a.email) })
      .eq("user_id", profile.id)
      .eq("month", `${month}-01`);
  }
  revalidatePath("/expenses");
  revalidatePath("/admin/expenses");
  const who = s.approvers.map((a) => (a.name || a.email).split(" ")[0]).join(", ");
  const done = `${monthLabel(month)} is sent for approval (${money(s.total)}).`;
  if (res.status === "sent") return { ok: `${done} ${who ? `${who} got an email.` : ""}` };
  return { warn: `${done} The approvers can see it in AMBIT Intelligence, but the email didn't go out${res.error ? ` (${res.error.slice(0, 100)})` : ""}.` };
}
