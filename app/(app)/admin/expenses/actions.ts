"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireExpenseApprover } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { lineKey, merchantName, readStatement } from "@/lib/expense-chase";
import { CATEGORIES, EXPENSE_FORM_ID, expensePdf, expensesReady, isMonth, monthLabel, toReceipt } from "@/lib/expenses";
import { mailReviewed } from "@/lib/expense-mail";
import { api, type Submission } from "@/lib/jotform";
import { exchange, linkToken, plaidReady, removeItem, syncAll, syncLink } from "@/lib/plaid";
import { money } from "@/lib/format";

// What approvers do in Admin > Expense reports. Everything goes through the database's own rules
// (is_expense_approver); the bank link's keys are handled with the server's own key, never sent to a browser.

type Res = { ok: true; msg?: string } | { ok: false; error: string };
const done = () => {
  revalidatePath("/admin/expenses");
  revalidatePath("/expenses");
};

// ------------------------------------------------------------------ approve / send back

export async function reviewMonth(userId: string, month: string, approve: boolean, note: string): Promise<Res> {
  const { supabase, profile } = await requireExpenseApprover();
  if (!isMonth(month)) return { ok: false, error: "Pick a month." };
  const { data, error } = await supabase.rpc("expense_review", { p_user: userId, p_month: `${month}-01`, p_approve: approve, p_note: note || null });
  if (error) return { ok: false, error: error.message };
  const r = data as { name: string; email: string; month: string; status: "approved" | "returned"; by: string; total: number; personal: number };
  let pdf;
  if (approve) {
    try {
      const out = await expensePdf(supabase, { id: userId, name: r.name, email: r.email }, month);
      pdf = { filename: out.filename, content: out.pdf, contentType: "application/pdf" };
    } catch {
      pdf = undefined;
    }
  }
  const res = await mailReviewed({ ...r, total: Number(r.total), personal: Number(r.personal), note: note || null }, await currentOrigin(), [profile.email], pdf);
  done();
  const first = r.name.split(" ")[0];
  const what = approve ? `Approved ${first}'s ${monthLabel(month)} (${money(Number(r.total))}).` : `Sent ${first}'s ${monthLabel(month)} back.`;
  return { ok: true, msg: res.status === "sent" ? `${what} ${first} got an email${approve ? " with the approved PDF" : ""}.` : `${what} (The email to ${first} didn't go out.)` };
}

// ------------------------------------------------------------------ card charges

export async function excuseCharge(chargeId: string, note: string | null, category: string | null): Promise<Res> {
  const { supabase } = await requireExpenseApprover();
  const { error } = await supabase.rpc("expense_excuse", { p_charge: chargeId, p_note: note, p_category: category && (CATEGORIES as readonly string[]).includes(category) ? category : null });
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}

export async function assignCharge(chargeId: string, userId: string | null): Promise<Res> {
  const { supabase } = await requireExpenseApprover();
  const { error } = await supabase.rpc("expense_assign_charge", { p_charge: chargeId, p_user: userId });
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}

export async function setCard(last4: string, userId: string | null, label: string | null): Promise<Res> {
  const { supabase } = await requireExpenseApprover();
  const { data, error } = await supabase.rpc("expense_set_card", { p_last4: last4.replace(/\D/g, "").slice(-4), p_user: userId, p_label: label });
  if (error) return { ok: false, error: error.message };
  done();
  const n = Number(data) || 0;
  return { ok: true, msg: n ? `${n} card ${n === 1 ? "charge" : "charges"} moved to them.` : undefined };
}

export async function matchNow(): Promise<Res> {
  const { supabase } = await requireExpenseApprover();
  const { data, error } = await supabase.rpc("expense_auto_match", { p_user: null });
  if (error) return { ok: false, error: error.message };
  done();
  const n = Number(data) || 0;
  return { ok: true, msg: n ? `Matched ${n} more card ${n === 1 ? "charge" : "charges"} to receipts.` : "Nothing new to match." };
}

// ------------------------------------------------------------------ statement upload

export type UploadState = { ok?: string; error?: string; cards?: string[]; needCard?: boolean } | null;

/** The Chase CSV: each line becomes a card charge (lines already uploaded are skipped), then matching runs. */
export async function uploadStatement(_prev: UploadState, form: FormData): Promise<UploadState> {
  const { supabase, profile } = await requireExpenseApprover();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the CSV file you downloaded from Chase." };
  if (file.size > 3 * 1024 * 1024) return { error: "That file is too big for a card statement. Download one month (or a few) at a time." };
  if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text/i.test(file.type)) return { error: "Use the CSV download (in Chase: Download account activity, File type: Spreadsheet (Excel, CSV))." };
  const read = readStatement(await file.text());
  if (read.problem) return { error: read.problem };
  const forced = String(form.get("card") ?? "").replace(/\D/g, "").slice(-4);
  if (!read.hasCard && forced.length !== 4) return { needCard: true, error: "This file doesn't say which card each charge was on. Type the card's last 4 digits and upload it again." };

  const { data: cards } = await supabase.from("expense_cards").select("last4, user_id");
  const owner = new Map(((cards ?? []) as { last4: string; user_id: string | null }[]).map((c) => [c.last4, c.user_id]));
  const { data: imp, error: impErr } = await supabase
    .from("expense_imports")
    .insert({ source: "upload", file_name: file.name.slice(0, 120), rows: read.lines.length, date_from: read.from, date_to: read.to, by_id: profile.id, by_name: profile.full_name || profile.email })
    .select("id")
    .single();
  if (impErr || !imp) return { error: impErr?.message ?? "Couldn't save the upload." };

  const rows = read.lines.map((l) => {
    const card = l.card ?? (forced.length === 4 ? forced : null);
    return {
      source: "upload",
      external_id: createHash("sha256").update(lineKey(l, card)).digest("hex").slice(0, 40),
      card_last4: card,
      user_id: card ? owner.get(card) ?? null : null,
      txn_date: l.txn_date,
      post_date: l.post_date,
      description: l.description,
      merchant: merchantName(l.description),
      bank_category: l.bank_category,
      kind: l.kind,
      amount: l.amount,
      import_id: imp.id,
      imported_by: profile.id,
    };
  });
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase.from("expense_charges").upsert(rows.slice(i, i + 500), { onConflict: "external_id", ignoreDuplicates: true }).select("id");
    if (error) return { error: `Saved ${added} lines, then: ${error.message}` };
    added += data?.length ?? 0;
  }
  await supabase.from("expense_imports").update({ added, skipped: rows.length - added }).eq("id", imp.id);
  const { data: matched } = await supabase.rpc("expense_auto_match", { p_user: null });
  done();
  const unknown = [...new Set(rows.filter((r) => r.card_last4 && !owner.get(r.card_last4)).map((r) => r.card_last4 as string))];
  const n = Number(matched) || 0;
  return {
    ok: `${added} new card ${added === 1 ? "charge" : "charges"} added${rows.length - added ? ` (${rows.length - added} were already here)` : ""}. ${n} matched to receipts.${unknown.length ? ` Cards nobody is assigned to yet: ${unknown.map((c) => `••${c}`).join(", ")}. Assign them below.` : ""}`,
    cards: unknown,
  };
}

/** Takes back one upload: its charges go away (ones already matched to a receipt are unmatched first). */
export async function undoUpload(importId: string): Promise<Res> {
  const { supabase } = await requireExpenseApprover();
  const { data: rows } = await supabase.from("expense_charges").select("id, receipt_id, user_id, txn_date").eq("import_id", importId);
  const list = (rows ?? []) as { id: string; receipt_id: string | null }[];
  for (const r of list.filter((x) => x.receipt_id)) {
    const { error } = await supabase.rpc("expense_link", { p_charge: r.id, p_receipt: null });
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await supabase.from("expense_charges").delete().eq("import_id", importId);
  if (error) return { ok: false, error: error.message };
  await supabase.from("expense_imports").delete().eq("id", importId);
  done();
  return { ok: true, msg: `Removed ${list.length} card ${list.length === 1 ? "charge" : "charges"}.` };
}

// ------------------------------------------------------------------ approvers (admins)

export async function setApprovers(ids: string[]): Promise<Res> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("set_expense_approvers", { p_ids: ids });
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true, msg: `${data} ${Number(data) === 1 ? "approver" : "approvers"} saved.` };
}

// ------------------------------------------------------------------ the bank link (Plaid)

export async function plaidStart(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { profile } = await requireExpenseApprover();
  if (!plaidReady()) return { ok: false, error: "The bank link isn't set up yet (PLAID_CLIENT_ID and PLAID_SECRET in Vercel)." };
  if (!serviceReady()) return { ok: false, error: "SUPABASE_SECRET_KEY isn't set in Vercel, so the bank link can't be saved." };
  try {
    return { ok: true, token: await linkToken(profile.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Plaid didn't answer." };
  }
}

/** Plaid's window finished: keep the bank's key (server only) and bring in the charges. */
export async function plaidFinish(publicToken: string, institution: string | null): Promise<Res> {
  const { supabase, profile } = await requireExpenseApprover();
  if (!plaidReady() || !serviceReady()) return { ok: false, error: "The bank link isn't set up yet." };
  try {
    const x = await exchange(publicToken);
    const db = serviceClient();
    const { data: link, error } = await db
      .from("expense_bank_links")
      .upsert({ item_id: x.item_id, access_token: x.access_token, institution: (institution || "Bank").slice(0, 80), created_by: profile.id, status: "ok", error: null }, { onConflict: "item_id" })
      .select("id, item_id, access_token, cursor")
      .single();
    if (error || !link) return { ok: false, error: error?.message ?? "Couldn't save the bank link." };
    const r = await syncLink(db, link as { id: string; item_id: string; access_token: string; cursor: string | null });
    await supabase.rpc("expense_auto_match", { p_user: null });
    done();
    if (r.error) return { ok: true, msg: `Connected. The first download is still coming from the bank (${r.error}); it finishes on its own within a day.` };
    return { ok: true, msg: `Connected. ${r.added} card ${r.added === 1 ? "charge" : "charges"} came in${r.matched ? ` (${r.matched} were already here from statements)` : ""}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't connect." };
  }
}

export async function plaidSyncNow(): Promise<Res> {
  const { supabase } = await requireExpenseApprover();
  if (!plaidReady() || !serviceReady()) return { ok: false, error: "The bank link isn't set up yet." };
  const r = await syncAll(serviceClient());
  await supabase.rpc("expense_auto_match", { p_user: null });
  done();
  if (r.errors.length) return { ok: false, error: r.errors[0] };
  return { ok: true, msg: `${r.added} new card ${r.added === 1 ? "charge" : "charges"} from the bank.` };
}

export async function plaidDisconnect(id: string): Promise<Res> {
  await requireExpenseApprover();
  if (!serviceReady()) return { ok: false, error: "SUPABASE_SECRET_KEY isn't set." };
  const db = serviceClient();
  const { data } = await db.from("expense_bank_links").select("access_token").eq("id", id).maybeSingle();
  if (data?.access_token) await removeItem(data.access_token as string);
  await db.from("expense_bank_links").delete().eq("id", id);
  done();
  return { ok: true, msg: "Disconnected. Charges already here stay." };
}

// ------------------------------------------------------------------ the old Jotform receipts

/** Brings every receipt from the old Jotform form into the app (once each; running it again adds only new ones). */
export async function importJotform(): Promise<Res> {
  await requireExpenseApprover();
  if (!expensesReady()) return { ok: false, error: "The Jotform connection isn't set up (JOTFORM_API_KEY)." };
  if (!serviceReady()) return { ok: false, error: "SUPABASE_SECRET_KEY isn't set in Vercel." };
  const db = serviceClient();
  const all: Submission[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const page = await api<Submission[]>(`/form/${EXPENSE_FORM_ID}/submissions?limit=1000&offset=${offset}&orderby=created_at`, false);
    all.push(...(page ?? []).filter((s) => s.status !== "DELETED"));
    if (!page || page.length < 1000) break;
  }
  const { data: people } = await db.from("profiles").select("id, email").in("role", ["employee", "admin"]);
  const byEmail = new Map(((people ?? []) as { id: string; email: string }[]).map((p) => [p.email.toLowerCase(), p.id]));
  const { data: had } = await db.from("expense_receipts").select("jotform_id").not("jotform_id", "is", null);
  const have = new Set(((had ?? []) as { jotform_id: string }[]).map((r) => r.jotform_id));
  let added = 0;
  const nobody = new Set<string>();
  const rows = [];
  for (const s of all) {
    const r = toReceipt(s);
    if (have.has(r.id)) continue;
    const uid = byEmail.get(r.email);
    if (!uid) {
      if (r.email) nobody.add(r.email);
      continue;
    }
    if (r.amount === null || r.amount < 0) continue;
    rows.push({
      user_id: uid,
      bought_on: r.date,
      vendor: (r.vendor || "Receipt").slice(0, 80),
      amount: r.amount,
      category: (CATEGORIES as readonly string[]).includes(r.category) ? r.category : "Other",
      paid_with: r.paidWith,
      purpose: r.purpose || null,
      notes: r.notes || null,
      photos: r.files,
      no_photo_reason: r.files.length ? null : "Sent through the old Jotform form without a photo",
      source: "jotform",
      jotform_id: r.id,
      created_at: Number.isFinite(Date.parse(`${r.created_at?.replace(" ", "T")}Z`)) ? new Date(`${r.created_at.replace(" ", "T")}Z`).toISOString() : undefined,
    });
  }
  for (let i = 0; i < rows.length; i += 300) {
    const { data, error } = await db.from("expense_receipts").upsert(rows.slice(i, i + 300), { onConflict: "jotform_id", ignoreDuplicates: true }).select("id");
    if (error) return { ok: false, error: `Brought over ${added}, then: ${error.message}` };
    added += data?.length ?? 0;
  }
  await db.rpc("expense_auto_match", { p_user: null });
  done();
  return {
    ok: true,
    msg: `Brought over ${added} old ${added === 1 ? "receipt" : "receipts"} from Jotform.${nobody.size ? ` ${nobody.size} email ${nobody.size === 1 ? "address doesn't" : "addresses don't"} match a login, so those were left in Jotform: ${[...nobody].slice(0, 6).join(", ")}.` : ""}`,
  };
}
