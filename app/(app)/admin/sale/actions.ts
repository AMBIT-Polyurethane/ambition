"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { ADC_CATALOG_TAG } from "@/lib/adc";
import { requireAdmin } from "@/lib/session";

export type SaleResult = { ok: true; message: string } | { ok: false; message: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const done = (message: string): SaleResult => {
  revalidatePath("/admin/sale");
  revalidatePath("/adc", "layout");
  revalidateTag(ADC_CATALOG_TAG);
  return { ok: true, message };
};

/** Sale prices for the rows that changed (blank = no sale price yet). */
export async function saveSalePrices(saleId: number, rows: { product_id: string; price: number | null }[]): Promise<SaleResult> {
  const { supabase } = await requireAdmin();
  const clean = rows
    .filter((r) => r && typeof r.product_id === "string" && /^[0-9a-f-]{36}$/.test(r.product_id))
    .map((r) => ({ sale_id: saleId, product_id: r.product_id, price: r.price === null || !Number.isFinite(r.price) || r.price < 0 ? null : Math.round(r.price * 100) / 100, updated_at: new Date().toISOString() }));
  if (!clean.length) return { ok: false, message: "Nothing to save." };
  const { error } = await supabase.from("web_sale_items").upsert(clean, { onConflict: "sale_id,product_id" });
  if (error) return { ok: false, message: error.message };
  return done(`Saved ${clean.length} ${clean.length === 1 ? "price" : "prices"}.`);
}

/** Items that aren't in the sale come off the sheet (and off the store's sale). */
export async function removeSaleItems(saleId: number, ids: string[]): Promise<SaleResult> {
  const { supabase } = await requireAdmin();
  const list = ids.filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 1000);
  if (!list.length) return { ok: false, message: "Pick the items to take off first." };
  const { error } = await supabase.from("web_sale_items").delete().eq("sale_id", saleId).in("product_id", list);
  if (error) return { ok: false, message: error.message };
  return done(`Took ${list.length} ${list.length === 1 ? "item" : "items"} off the sale.`);
}

export async function addSaleItems(saleId: number, ids: string[]): Promise<SaleResult> {
  const { supabase } = await requireAdmin();
  const list = ids.filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 1000);
  if (!list.length) return { ok: false, message: "Pick an item to add." };
  const { error } = await supabase.from("web_sale_items").upsert(list.map((product_id) => ({ sale_id: saleId, product_id })), { onConflict: "sale_id,product_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: error.message };
  return done(`Added ${list.length} ${list.length === 1 ? "item" : "items"}.`);
}

/** The sale's name, dates and the spray foam discount ($ per lb off each customer's price). */
export async function saveSaleSettings(saleId: number, s: { name: string; starts_on: string; ends_on: string; foam_off_per_lb: number | null }): Promise<SaleResult> {
  const { supabase } = await requireAdmin();
  if (!DAY.test(s.starts_on) || !DAY.test(s.ends_on) || s.ends_on < s.starts_on) return { ok: false, message: "Check the dates: the last day can't be before the first." };
  const foam = s.foam_off_per_lb === null || !Number.isFinite(s.foam_off_per_lb) || s.foam_off_per_lb <= 0 ? null : Math.round(s.foam_off_per_lb * 10000) / 10000;
  const { error } = await supabase
    .from("web_sales")
    .update({ name: s.name.trim().slice(0, 60) || "Sale", starts_on: s.starts_on, ends_on: s.ends_on, foam_off_per_lb: foam })
    .eq("id", saleId);
  if (error) return { ok: false, message: error.message };
  return done("Saved the sale settings.");
}

/** Our cost for each SKU, from the Item Master workbook ("Our Cost"). */
export async function loadCosts(rows: { sku: string; cost: number }[], source: string): Promise<SaleResult> {
  const { supabase } = await requireAdmin();
  const clean = rows.filter((r) => r && r.sku && Number.isFinite(r.cost) && r.cost >= 0).map((r) => ({ sku: String(r.sku).trim().slice(0, 60), cost: Math.round(r.cost * 10000) / 10000 })).slice(0, 5000);
  if (!clean.length) return { ok: false, message: "No costs found in that file. It needs an SKU column and an Our Cost column." };
  const { data, error } = await supabase.rpc("admin_set_costs", { p: clean, p_source: source.slice(0, 120) });
  if (error) return { ok: false, message: error.message };
  return done(`Loaded costs for ${data ?? 0} of ${clean.length} SKUs in the file${Number(data) < clean.length ? " (the rest aren't products in the app)" : ""}.`);
}
