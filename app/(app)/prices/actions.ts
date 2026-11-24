"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { canPrice, type PriceEdit } from "@/lib/prices";

const nice = (e: { message?: string } | null) => (e?.message ?? "Something went wrong.").replace(/^.*?ERROR:\s*/, "");

/** Save changed customer prices (a blank price removes it). From the customer's price list or the master sheet. */
export async function savePrices(items: PriceEdit[], source: "manual" | "import" | "netsuite" = "manual", ref?: string): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only admins and price approvers change customer prices." };
  const clean = items
    .filter((i) => i.company_id && i.product_id)
    .map((i) => {
      const t = (i.price ?? "").toString().replace(/[$,\s]/g, "");
      return { ...i, price: t === "" ? null : t };
    });
  const bad = clean.find((i) => i.price !== null && !/^\d*\.?\d+$/.test(i.price));
  if (bad) return { ok: false, error: `"${bad.price}" isn't a price. Type a number like 2.45.` };
  let saved = 0;
  // In chunks so a big spreadsheet doesn't time out.
  for (let i = 0; i < clean.length; i += 500) {
    const { data, error } = await s.supabase.rpc("customer_prices_save", { p_items: clean.slice(i, i + 500), p_source: source, p_ref: ref ?? null });
    if (error) return { ok: false, error: `${nice(error)}${saved ? ` (${saved} were saved first)` : ""}` };
    saved += Number(data ?? 0);
  }
  revalidatePath("/prices");
  for (const c of new Set(clean.map((i) => i.company_id))) revalidatePath(`/customers/${c}/prices`);
  return { ok: true, saved };
}

// ---------------------------------------------------------------- the pricing dashboard (0106)

export type BulkInput = {
  customers: string[];
  all_customers: boolean;
  include_base: boolean;
  products: string[];
  method: "pct" | "add" | "set";
  amount: string;
  effective_on: string;
  only_own: boolean;
  note?: string;
};
export type BulkRow = { company: string; company_id: string | null; sku: string; product: string; unit: string; basis: "unit" | "lb" | "sqft"; old: number | null; new: number; own: boolean };
export type BulkPreview = { changes: number; customers: number; base: number; products: number; up: number; down: number; rows: BulkRow[] };

const needs0106 = (e: { message?: string } | null) => /price_bulk|price_apply_due|base_prices_save|price_import/.test(e?.message ?? "");
const bulkBody = (b: BulkInput) => ({
  customers: b.all_customers ? [] : b.customers,
  all_customers: b.all_customers,
  include_base: b.include_base,
  products: b.products,
  method: b.method,
  amount: b.amount.replace(/[$,%\s]/g, ""),
  effective_on: b.effective_on,
  only_own: b.only_own,
  note: b.note ?? "",
});

/** What a change would do, before anything is saved. */
export async function bulkPreview(b: BulkInput): Promise<{ ok: true; preview: BulkPreview } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only people who can change customer prices use the pricing dashboard." };
  const { data, error } = await s.supabase.rpc("price_bulk", { p: bulkBody(b), p_apply: false });
  if (error) return { ok: false, error: needs0106(error) ? "The pricing dashboard needs the 0106 database update first." : nice(error) };
  const d = data as BulkPreview;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ok: true, preview: { ...d, rows: (d.rows ?? []).map((r) => ({ ...r, old: n(r.old), new: Number(r.new) })) } };
}

/** Make the change (today, or from a later day). */
export async function bulkApply(b: BulkInput): Promise<{ ok: true; batch: number; changes: number; now: boolean } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only people who can change customer prices use the pricing dashboard." };
  const { data, error } = await s.supabase.rpc("price_bulk", { p: bulkBody(b), p_apply: true });
  if (error) return { ok: false, error: needs0106(error) ? "The pricing dashboard needs the 0106 database update first." : nice(error) };
  const d = data as { batch: number; changes: number; now: boolean };
  revalidatePath("/prices", "layout");
  revalidatePath("/customers", "layout");
  return { ok: true, batch: Number(d.batch), changes: Number(d.changes), now: Boolean(d.now) };
}

/** Undo a change: prices go back unless they were changed again since; changes still waiting are cancelled. */
export async function bulkUndo(batch: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only people who can change customer prices use the pricing dashboard." };
  const { data, error } = await s.supabase.rpc("price_bulk_undo", { p_batch: batch });
  if (error) return { ok: false, error: nice(error) };
  const d = data as { reverted: number; cancelled: number; kept: number };
  revalidatePath("/prices", "layout");
  revalidatePath("/customers", "layout");
  const parts = [d.reverted ? `${d.reverted} price${d.reverted === 1 ? "" : "s"} put back` : "", d.cancelled ? `${d.cancelled} waiting change${d.cancelled === 1 ? "" : "s"} cancelled` : "", d.kept ? `${d.kept} left alone because ${d.kept === 1 ? "it was" : "they were"} changed again since` : ""].filter(Boolean);
  return { ok: true, text: parts.length ? `Undone: ${parts.join(", ")}.` : "Undone. Nothing needed changing back." };
}

/** Base prices typed on the Base prices page (blank removes a foam or batt base price). */
export async function saveBasePrices(items: { product_id: string; price: string | null; basis: "unit" | "lb" | "sqft" }[]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only people who can change customer prices change base prices." };
  const clean = items.map((i) => ({ ...i, price: (i.price ?? "").toString().replace(/[$,\s]/g, "") || null }));
  const bad = clean.find((i) => i.price !== null && !/^\d*\.?\d+$/.test(i.price));
  if (bad) return { ok: false, error: `"${bad.price}" isn't a price. Type a number like 2.45.` };
  const { data, error } = await s.supabase.rpc("base_prices_save", { p_items: clean });
  if (error) return { ok: false, error: needs0106(error) ? "Base prices need the 0106 database update first." : nice(error) };
  revalidatePath("/prices", "layout");
  return { ok: true, saved: Number(data ?? 0) };
}

/** A customer's pricing notes (special prices, freight terms), shown on their price page. */
export async function savePriceNote(company: string, note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only people who can change customer prices change pricing notes." };
  const { error } = await s.supabase.from("companies").update({ price_note: note.trim().slice(0, 4000) || null }).eq("id", company);
  if (error) return { ok: false, error: nice(error) };
  revalidatePath(`/customers/${company}/prices`);
  return { ok: true };
}

// ---------------------------------------------------------------- the foam price sheet import (0107)

/** Match a sheet row to a customer (null clears it), or skip it. */
export async function importMatch(row: number, company: string | null, skip = false): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only people who can change customer prices import price sheets." };
  const { error } = await s.supabase.rpc("price_import_set", { p_row: row, p_company: company, p_skip: skip });
  if (error) return { ok: false, error: nice(error) };
  revalidatePath("/prices/import");
  return { ok: true };
}

/** Import every matched row: their foam prices and notes go on the customers. */
export async function importRun(): Promise<{ ok: true; rows: number; prices: number } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only people who can change customer prices import price sheets." };
  const { data, error } = await s.supabase.rpc("price_import_run", { p_rows: null });
  if (error) return { ok: false, error: needs0106(error) ? "The import needs the 0107 database update first." : nice(error) };
  const d = data as { rows: number; prices: number };
  revalidatePath("/prices", "layout");
  revalidatePath("/customers", "layout");
  return { ok: true, rows: Number(d.rows), prices: Number(d.prices) };
}

// ---------------------------------------------------------------- markup on cost by group (0112)

/** Admins: remember the markup % used for one customer's product group (the prices themselves save with savePrices). */
export async function saveCategoryMarkup(company: string, category: string, pct: number, items: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin" || s.profile.status !== "active") return { ok: false, error: "Only admins set markups." };
  if (!/^[0-9a-f-]{36}$/i.test(company) || !/^[a-z0-9_-]{1,80}$/i.test(category) || !Number.isFinite(pct) || pct <= -100 || pct >= 10000) return { ok: false, error: "Check the markup %." };
  const { error } = await s.supabase.from("customer_category_markups").upsert({
    company_id: company,
    category_id: category,
    markup_pct: Math.round(pct * 100) / 100,
    items,
    set_by_name: s.profile.full_name ?? s.profile.email,
    set_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: /customer_category_markups|schema cache/i.test(error.message) ? "The prices saved, but remembering the markup needs database update 0112." : error.message };
  revalidatePath(`/customers/${company}/prices`);
  return { ok: true };
}
