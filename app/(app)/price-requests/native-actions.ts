"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/access";
import { priceRules, prRef, tellApprovers, tellRep, type PrLine, type PrRow } from "@/lib/price-requests";
import { scorePriceRequest, type Line, type PrScore, type Req } from "@/lib/prf-score";
import { DETAIL_KEYS, type PrDetails } from "@/lib/pr-details";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS = "Price requests in the app need the 0066 database update first. Ask Jeremiah to run it.";
const missing = (m: string) => /price_request|price_floor|function|schema cache|does not exist/i.test(m);

async function load(db: SupabaseClient, id: number) {
  const [{ data: r }, { data: lines }] = await Promise.all([
    db.from("price_requests").select("*").eq("id", id).maybeSingle(),
    db.from("price_request_lines").select("*").eq("request_id", id).order("id"),
  ]);
  return { r: r as PrRow | null, lines: (lines ?? []) as PrLine[] };
}

export type SmartPrfInput = {
  customer_kind: "existing" | "new"; company_id: string | null; customer: Record<string, string>; product_lines: string[]; branch: string; note: string; valid_days: number;
  /** An item (intumescents, coatings), or a type (0076: foam per lb, fiberglass per sq ft, blow-in per bag) with the products it covers. */
  lines: ({ product_id: string; price: string; basis: string; volume: string } | { type: string; label: string; unit: string; products: string[]; price: string; basis: string; volume: string })[];
};

/** The smart price request (existing or new customer, every customer field, product lines, per-lb / per-sq-ft prices). */
export async function submitSmartPrf(input: SmartPrfInput): Promise<{ ok: false; error: string } | { ok: true; id: number; auto: number; lines: number }> {
  const s = await getSession();
  if (!s?.profile || !(can(s.profile, "price_requests") || s.profile.role === "admin")) return { ok: false, error: "You don't have access to price requests." };
  const price = (v: string) => Math.round(Number(v) * 10000) / 10000;
  const lines = input.lines
    .filter((l) => Number(l.price) > 0 && ("type" in l ? /^[a-z]+:[A-Z0-9-]+$/i.test(l.type) : UUID.test(l.product_id)))
    .map((l) =>
      "type" in l
        ? { type: l.type, label: l.label.slice(0, 120), unit: l.unit.slice(0, 20), products: l.products.filter((x) => UUID.test(x)), price: price(l.price), basis: l.basis, volume: l.volume.trim().slice(0, 80) }
        : { product_id: l.product_id, price: price(l.price), basis: l.basis, volume: l.volume.trim().slice(0, 80) },
    );
  const { data, error } = await s.supabase.rpc("price_request_submit2", { p: { ...input, lines } });
  if (error) {
    // Before 0076 the database still asks for the old boxes (billing terms, credit line now, freight).
    if (/billing_terms|credit_range|freight_included/.test(error.message)) return { ok: false, error: "The new price request form needs the 0076 database update first (Supabase > SQL Editor)." };
    return { ok: false, error: missing(error.message) && !/Fill in|Pick|Add/.test(error.message) ? "The smart price request needs the 0068 database update first." : error.message.replace(/^.*?ERROR:\s*/, "") };
  }
  const res = data as { id: number; lines: number; auto: number };
  const { r, lines: saved } = await load(s.supabase, res.id);
  if (r) {
    if (res.auto < res.lines) await tellApprovers(s.supabase, r, saved).catch(() => null);
    else await tellRep(s.supabase, r, saved).catch(() => null);
  }
  revalidatePath("/price-requests", "layout");
  return { ok: true, id: res.id, auto: res.auto, lines: res.lines };
}

/** What an existing customer pays now (shown beside each item while quoting). */
export async function customerPricesFor(company: string): Promise<{ product_id: string; price: number; basis: "unit" | "lb" | "sqft" }[]> {
  const s = await getSession();
  if (!s?.profile || !UUID.test(company)) return [];
  const { data } = await s.supabase.from("customer_prices").select("product_id, price, basis").eq("company_id", company);
  return (data ?? []) as { product_id: string; price: number; basis: "unit" | "lb" | "sqft" }[];
}

export type PrInput = { companyId: string; companyName: string; contact: string; branch: string; note: string; validDays: number; lines: { product_id: string; price: number; volume: string }[] };

export async function submitPriceRequest(input: PrInput): Promise<{ ok: false; error: string } | { ok: true; id: number; auto: number; lines: number }> {
  const s = await getSession();
  if (!s?.profile || !(can(s.profile, "price_requests") || s.profile.role === "admin")) return { ok: false, error: "You don't have access to price requests." };
  const lines = input.lines.filter((l) => UUID.test(l.product_id) && Number(l.price) > 0).map((l) => ({ product_id: l.product_id, price: Math.round(Number(l.price) * 100) / 100, volume: l.volume.trim().slice(0, 80) }));
  if (!lines.length) return { ok: false, error: "Add at least one product and the price you need." };
  const { data, error } = await s.supabase.rpc("price_request_submit", {
    p_company: UUID.test(input.companyId) ? input.companyId : null,
    p_company_name: input.companyName.trim() || null,
    p_contact: input.contact.trim() || null,
    p_branch: input.branch || null,
    p_note: input.note.trim() || null,
    p_valid_days: input.validDays,
    p_lines: lines,
  });
  if (error) return { ok: false, error: missing(error.message) ? NEEDS : error.message };
  const res = data as { id: number; lines: number; auto: number };
  const { r, lines: saved } = await load(s.supabase, res.id);
  if (r) {
    if (res.auto < res.lines) await tellApprovers(s.supabase, r, saved).catch(() => null);
    else await tellRep(s.supabase, r, saved).catch(() => null);
  }
  revalidatePath("/price-requests", "layout");
  return { ok: true, id: res.id, auto: res.auto, lines: res.lines };
}

export async function decidePriceRequest(id: number, lines: { id: number; status: "approved" | "denied"; price: string }[], note: string): Promise<{ ok: false; error: string } | { ok: true; status: string }> {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "prf_approve")) return { ok: false, error: "Only price approvers can do that." };
  const { data, error } = await s.supabase.rpc("price_request_decide", {
    p_id: id,
    p_lines: lines.map((l) => ({ id: l.id, status: l.status, price: l.price.replace(/[^\d.]/g, "") })),
    p_note: note.trim() || null,
  });
  if (error) return { ok: false, error: missing(error.message) ? NEEDS : error.message };
  const { r, lines: saved } = await load(s.supabase, id);
  if (r && r.status !== "pending") await tellRep(s.supabase, r, saved).catch(() => null);
  revalidatePath("/price-requests", "layout");
  return { ok: true, status: String(data) };
}

/**
 * Price approvers: edit a request after it's answered (or while it waits).
 * Details (customer, contact, good-through date, rep's note) save quietly; changed prices or a changed note
 * for the rep go through the normal decision, so customer prices update and the rep is emailed.
 */
export async function editPriceRequest(
  id: number,
  details: PrDetails,
  answer: { lines: { id: number; status: "approved" | "denied"; price: string }[]; note: string } | null,
): Promise<{ ok: false; error: string } | { ok: true; emailed: boolean }> {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "prf_approve")) return { ok: false, error: "Only price approvers can do that." };
  const p: Record<string, string> = {};
  for (const k of DETAIL_KEYS) p[k] = String(details[k] ?? "").trim().slice(0, k === "note" ? 2000 : 200);
  if (p.valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(p.valid_until)) return { ok: false, error: "Pick a good-through date, or leave it empty." };
  if (!p.legal_name) return { ok: false, error: "The customer needs a name." };
  const { error } = await s.supabase.rpc("price_request_edit", { p_id: id, p });
  if (error) return { ok: false, error: /price_request_edit|schema cache|does not exist/i.test(error.message) ? "Editing needs the 0092 database update first (Supabase > SQL Editor)." : error.message };
  let emailed = false;
  if (answer) {
    const { error: e2 } = await s.supabase.rpc("price_request_decide", {
      p_id: id,
      p_lines: answer.lines.map((l) => ({ id: l.id, status: l.status, price: l.price.replace(/[^\d.]/g, "") })),
      p_note: answer.note.trim() || null,
    });
    if (e2) return { ok: false, error: `The details were saved, but the prices weren't: ${e2.message}` };
    const { r, lines: saved } = await load(s.supabase, id);
    if (r && r.status !== "pending") {
      await tellRep(s.supabase, r, saved).catch(() => null);
      emailed = Boolean(r.created_by);
    }
  }
  revalidatePath("/price-requests", "layout");
  return { ok: true, emailed };
}

export async function withdrawPriceRequest(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = Number(form.get("id"));
  await s.supabase.rpc("price_request_withdraw", { p_id: id });
  revalidatePath("/price-requests", "layout");
  redirect(`/price-requests/n/${id}?msg=${encodeURIComponent(`${prRef(id)} withdrawn.`)}`);
}

/** Admins: the auto-approve rules. */
export async function saveRules(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const cur = await priceRules(s.supabase);
  const pct = (v: FormDataEntryValue | null) => Math.max(0, Math.min(90, Number(String(v ?? "").replace(/[^\d.]/g, "")) || 0));
  const cat_pct: Record<string, number> = {};
  const never: string[] = [];
  for (const [k, v] of form.entries()) {
    if (k.startsWith("cat:") && String(v).trim() !== "") cat_pct[k.slice(4)] = pct(v);
    if (k.startsWith("never:") && v === "on") never.push(k.slice(6));
  }
  const value = { ...cur, enabled: form.get("enabled") === "on", max_pct: pct(form.get("max_pct")), cat_pct, never, max_lines: Math.max(1, Math.min(100, Number(form.get("max_lines")) || 15)) };
  const { error } = await s.supabase.from("app_settings").upsert({ key: "price_rules", value, updated_at: new Date().toISOString(), updated_by_name: s.profile.full_name ?? s.profile.email });
  revalidatePath("/price-requests", "layout");
  redirect(`/price-requests/rules?${error ? `err=${encodeURIComponent(error.message)}` : "msg=Rules saved."}`);
}

/** Admins: floor prices (the lowest a price can be approved by the rules). */
export async function saveFloors(items: { product_id: string; floor: string }[]): Promise<{ ok: false; error: string } | { ok: true; n: number }> {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return { ok: false, error: "Only admins set floor prices." };
  const clean = items.filter((i) => UUID.test(i.product_id)).map((i) => ({ product_id: i.product_id, floor: i.floor.replace(/[^\d.]/g, "") }));
  const { data, error } = await s.supabase.rpc("price_floor_set", { p_items: clean });
  if (error) return { ok: false, error: missing(error.message) ? NEEDS : error.message };
  revalidatePath("/price-requests/rules");
  return { ok: true, n: Number(data) };
}

/** Price approvers: the request's quality score (0088). Worked out and saved the first time it's opened; again on "Score again". */
export async function scorePr(id: number): Promise<{ ok: true; score: PrScore } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "prf_approve")) return { ok: false, error: "Only price approvers see the score." };
  const [{ data: r }, { data: ls }] = await Promise.all([
    s.supabase.from("price_requests").select("*").eq("id", id).maybeSingle(),
    s.supabase.from("price_request_lines").select("*").eq("request_id", id).order("id"),
  ]);
  if (!r) return { ok: false, error: "Price request not found." };
  return scorePriceRequest(s.supabase, r as Req, (ls ?? []) as Line[]);
}
