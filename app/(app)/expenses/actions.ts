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
import { CATEGORIES, INVENTORY, PEOPLE_CATS, isMonth, loadMonth, missing0062, monthLabel, type EndCustomer, type ReceiptLine } from "@/lib/expenses";
import { stockItems } from "@/lib/incoming";
import { inventoryBranches } from "@/lib/widgets";
import { emailAdminsReportWaiting } from "@/lib/receiving-notify";
import { kickSync } from "@/lib/inventory/sync";
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
  /** Two or more kinds of things on one receipt (fuel and food at a gas station): one line each. */
  lines: ReceiptLine[] | null;
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
      lines: {
        type: "array",
        description:
          "Only when the receipt clearly mixes kinds of purchases (e.g. fuel at the pump and food inside a gas station): one entry per category with its amount, tax shared out, adding up to the total. Otherwise an empty array.",
        items: { type: "object", properties: { category: { type: "string", enum: [...CATEGORIES] }, amount: { type: "number" } }, required: ["category", "amount"] },
      },
    },
    required: ["vendor", "date", "total", "tip", "tip_blank", "category", "card_last4", "summary", "note", "lines"],
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
      system: `You read store and restaurant receipts for AMBIT Polyurethane's employee expense reports. Read only what's printed or written; leave a field empty (or 0) if you can't read it. Today is ${todayCentral()} (receipts are from the last few weeks, almost never the future). Categories: Fuel (gas, diesel), Meals (food the employee bought, alone or with coworkers), Customer entertainment (meals or outings with customers), Lodging, Airfare & travel (flights, rental cars, rideshare, parking, tolls), Vehicle & equipment repair, Tools & supplies (for the employee's own work), Inventory (products bought to stock an AMBIT warehouse), Shipping, Training events (classes, certifications, seminars), Tradeshows (booth fees, show registration), Lab expenses (testing and lab supplies), R&D (research and product development), Other. Restaurants: pick Meals unless the receipt clearly shows a customer outing. category is the biggest part of the receipt; when it mixes kinds (fuel and food), also fill lines.`,
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
        lines: (() => {
          const raw = Array.isArray(data.lines) ? (data.lines as { category?: unknown; amount?: unknown }[]) : [];
          const ls = raw
            .map((l) => ({ category: typeof l.category === "string" && (CATEGORIES as readonly string[]).includes(l.category) ? l.category : "", amount: cents(l.amount) ?? 0 }))
            .filter((l) => l.category && l.amount > 0);
          return ls.length > 1 && new Set(ls.map((l) => l.category)).size > 1 ? ls : null;
        })(),
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
  /** 0062: two or more lines on one receipt (they add up to the total). */
  lines?: { category: string; amount: number | string }[] | null;
  paid_with: "card" | "personal";
  card_last4?: string | null;
  company_id?: string | null;
  customer_name?: string | null;
  /** 0062: a distributor partner's own customers seen on the trip. */
  end_customers?: EndCustomer[] | null;
  purpose?: string | null;
  attendees?: string | null;
  notes?: string | null;
  photos: string[];
  no_photo_reason?: string | null;
  ai?: unknown;
  /** Made from a card charge ("Add receipt" next to it): link the two. */
  charge_id?: string | null;
  /** 0062: inventory bought on this receipt (when one of its lines is Inventory). */
  inventory?: InventoryBuy | null;
};
export type InventoryBuy = { branch: string; mode: "picked_up" | "shipped"; expected?: string | null; lines: { product_id: string; qty: number | string; lot_no?: string | null }[] };
export type InventoryDone = { id: number; status: "submitted" | "expected" | "received"; branch: string };

export type SaveResult =
  | { ok: true; id: string; month: string; matched: { day: string; amount: number; label: string } | null; inventory?: InventoryDone | null; warn?: string | null }
  | { ok: false; error: string };

const NEEDS_0062 = "Split receipts, distributor customers and inventory purchases need the 0062 database update first. Ask Jeremiah to run it.";

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
  const okCat = (c: unknown): c is string => typeof c === "string" && (CATEGORIES as readonly string[]).includes(c);

  // One category, or a split: every line has a category and an amount, and they add up to the total.
  let lines: ReceiptLine[] | null = null;
  const raw = Array.isArray(d.lines) ? d.lines : [];
  if (raw.length > 1) {
    lines = [];
    for (const l of raw.slice(0, 10)) {
      const a = cents(l.amount);
      if (!okCat(l.category)) return { ok: false, error: "Pick a category for every line." };
      if (a === null || a <= 0) return { ok: false, error: `Type the amount for the ${l.category} line.` };
      lines.push({ category: l.category, amount: a });
    }
    const sum = Math.round(lines.reduce((x, l) => x + l.amount, 0) * 100) / 100;
    if (Math.abs(sum - amount) >= 0.01) return { ok: false, error: `The lines add up to ${money(sum)}, but the total is ${money(amount)}. Make them match.` };
  }
  const category = lines ? [...lines].sort((a, b) => b.amount - a.amount)[0].category : okCat(d.category) ? d.category : "Other";
  const cats = new Set(lines ? lines.map((l) => l.category) : [category]);
  const tip = d.tip === null || d.tip === undefined || d.tip === "" ? null : cents(d.tip);
  const reason = t(d.no_photo_reason, 300);

  let existing: { id: string; user_id: string; photos: string[]; inbound_id?: number | null } | null = null;
  if (d.id) {
    let res = await supabase.from("expense_receipts").select("id, user_id, photos, inbound_id").eq("id", d.id).is("deleted_at", null).maybeSingle();
    if (res.error && missing0062(res.error)) res = await supabase.from("expense_receipts").select("id, user_id, photos").eq("id", d.id).is("deleted_at", null).maybeSingle();
    if (!res.data) return { ok: false, error: "That receipt wasn't found." };
    existing = res.data as { id: string; user_id: string; photos: string[]; inbound_id?: number | null };
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
  let distributor = false;
  if (companyId) {
    let co = await supabase.from("companies").select("id, name, distributor").eq("id", companyId).maybeSingle();
    if (co.error && missing0062(co.error)) co = (await supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle()) as typeof co;
    if (co.data) {
      customer = co.data.name as string;
      distributor = Boolean((co.data as { distributor?: boolean }).distributor);
    } else companyId = null;
  }
  const hasPeople = [...cats].some((c) => PEOPLE_CATS.has(c));
  const people = hasPeople ? t(d.attendees, 300) : null;
  if (cats.has("Customer entertainment") && !customer) return { ok: false, error: "Customer entertainment: pick the customer it was for." };

  // A distributor partner: which of their customers were seen.
  let ends: EndCustomer[] | null = null;
  if (distributor) {
    ends = (Array.isArray(d.end_customers) ? d.end_customers : [])
      .slice(0, 20)
      .map((c) => ({ name: t(c?.name, 80) ?? "", business: t(c?.business, 120) ?? "", phone: (t(c?.phone, 30) ?? "").replace(/[^\d+()\-.\s x]/g, "") }))
      .filter((c) => c.name || c.business || c.phone);
    if (!ends.length) return { ok: false, error: `${customer} is a distributor partner: add the customer(s) of theirs you saw (name, business and phone).` };
    if (ends.some((c) => !c.name && !c.business)) return { ok: false, error: "Each of the distributor's customers needs a name or a business name." };
  }

  // Inventory: which warehouse, what, and whether it's in hand or on its way.
  const buying = cats.has(INVENTORY);
  let buy: InventoryBuy | null = null;
  let branchName = "";
  if (buying) {
    const b = d.inventory;
    if (!b || !b.branch) return { ok: false, error: "Inventory: pick the warehouse it's for." };
    const branches = await inventoryBranches(supabase, profile, { all: true });
    const br = branches.find((x) => x.id === b.branch);
    if (!br) return { ok: false, error: "Inventory: pick the warehouse it's for." };
    branchName = br.name;
    if (b.mode !== "picked_up" && b.mode !== "shipped") return { ok: false, error: "Inventory: say whether you have it or it's being shipped." };
    const expected = b.mode === "shipped" ? t(b.expected, 10) : null;
    if (b.mode === "shipped" && (!expected || !DAY.test(expected))) return { ok: false, error: "Inventory: pick the day it should get there." };
    const items = (Array.isArray(b.lines) ? b.lines : [])
      .map((l) => ({ product_id: t(l.product_id, 40) ?? "", qty: cents(l.qty) ?? 0, lot_no: t(l.lot_no, 60) }))
      .filter((l) => l.product_id && l.qty > 0);
    if (!items.length) return { ok: false, error: "Inventory: add the items you bought and how many." };
    buy = { branch: br.id, mode: b.mode, expected, lines: items };
  }

  const base = {
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
  const row = { ...base, lines, end_customers: ends };

  let id = existing?.id ?? null;
  const write = async (r: Record<string, unknown>) =>
    existing
      ? await supabase.from("expense_receipts").update(r).eq("id", existing.id).select("id").single()
      : await supabase.from("expense_receipts").insert({ ...r, user_id: profile.id }).select("id").single();
  let res = await write(row);
  if (res.error && missing0062(res.error)) {
    // The database doesn't have 0062 yet: a plain receipt still saves; a split, distributor or inventory one can't.
    if (lines || ends || buying) return { ok: false, error: NEEDS_0062 };
    res = await write(base);
  }
  if (res.error || !res.data) return { ok: false, error: res.error?.message ?? "Couldn't save the receipt." };
  id = res.data.id as string;

  // Inventory: a Receiving Report for an admin to approve (in hand), or an expected delivery (being shipped).
  let inventory: InventoryDone | null = null;
  let warn: string | null = null;
  if (buy) {
    const { data, error } = await supabase.rpc("expense_inventory", { p_receipt: id, p_branch: buy.branch, p_mode: buy.mode, p_expected: buy.expected, p_lines: buy.lines });
    if (error) warn = `The receipt is saved, but the inventory wasn't: ${error.message} Open the receipt and try again.`;
    else {
      const out = data as { id: number; status: InventoryDone["status"] };
      inventory = { id: Number(out.id), status: out.status, branch: branchName };
      if (out.status === "submitted") await emailAdminsReportWaiting(supabase, inventory.id).catch(() => null);
      if (out.status === "received") kickSync(buy.branch, "card purchase");
      revalidatePath("/inventory", "layout");
    }
  } else if (existing?.inbound_id) {
    // Inventory came off the receipt: cancel the report while it's still waiting.
    await supabase.rpc("expense_inventory", { p_receipt: id, p_branch: null, p_mode: "none", p_expected: null, p_lines: [] });
    revalidatePath("/inventory", "layout");
  }

  // Match it to its card charge: the one it was added from, or the closest fit.
  if (d.charge_id) {
    const { error } = await supabase.rpc("expense_link", { p_charge: d.charge_id, p_receipt: id });
    if (error) return { ok: false, error: `Saved, but couldn't attach it to that card charge: ${error.message}` };
  } else if (base.paid_with === "card") {
    await supabase.rpc("expense_auto_match", { p_user: owner === profile.id ? profile.id : owner });
  }
  const { data: m } = await supabase.from("expense_charges").select("txn_date, amount, merchant, description").eq("receipt_id", id).maybeSingle();
  revalidatePath("/expenses");
  return {
    ok: true,
    id: id!,
    month: day.slice(0, 7),
    matched: m ? { day: m.txn_date as string, amount: Number(m.amount), label: ((m.merchant as string) || (m.description as string) || "").trim() } : null,
    inventory,
    warn,
  };
}

// ------------------------------------------------------------------ inventory picker

export type BuyItem = { id: string; sku: string; name: string; unit: string; lot: boolean };

/** The items on one warehouse's inventory sheet, for "what did you buy". */
export async function buyableItems(branch: string): Promise<BuyItem[]> {
  const { supabase, profile } = await requireEmployee();
  const branches = await inventoryBranches(supabase, profile, { all: true });
  if (!branches.some((b) => b.id === branch)) return [];
  const items = await stockItems(supabase, branch);
  return items.map((i) => ({ id: i.product_id, sku: i.sku, name: i.name, unit: i.unit, lot: Boolean(i.lots || i.track) }));
}

/** What's on a receipt's inventory report now (to edit it, or to show it's already in stock). */
export async function receiptInventory(inboundId: number): Promise<{ branch: string; status: string; expected: string; lines: { product_id: string; sku: string; name: string; unit: string; qty: number; lot_no: string | null }[] } | null> {
  const { supabase } = await requireEmployee();
  const { data } = await supabase
    .from("inbound_deliveries")
    .select("branch_id, status, expected_on, inbound_lines(product_id, sku, name, unit, qty, lot_no)")
    .eq("id", inboundId)
    .maybeSingle();
  if (!data) return null;
  const x = data as unknown as { branch_id: string; status: string; expected_on: string; inbound_lines: { product_id: string; sku: string; name: string | null; unit: string | null; qty: number; lot_no: string | null }[] };
  return {
    branch: x.branch_id,
    status: x.status,
    expected: x.expected_on,
    lines: (x.inbound_lines ?? []).map((l) => ({ product_id: l.product_id, sku: l.sku, name: l.name ?? l.sku, unit: l.unit ?? "each", qty: Number(l.qty), lot_no: l.lot_no })),
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
