"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/access";
import { priceRules, prRef, tellApprovers, tellRep, type PrLine, type PrRow } from "@/lib/price-requests";

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
