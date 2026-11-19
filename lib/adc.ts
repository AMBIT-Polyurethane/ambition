import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** One item in the ADC web store (what adc_catalog() returns: no costs, no stock, no customer data). */
export type AdcItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string | null;
  category_id: string | null;
  category: string | null;
  cat_sort: number;
  list_price: number | null;
  quote: boolean;
  sale_price: number | null;
  image: string | null;
  sort: number;
};
export type AdcSale = { slug: string; name: string; starts_on: string; ends_on: string; foam_off_per_lb: number | null };

/** The whole store, once per page load (the header, the page and the cart all share it). */
export const adcCatalog = cache(async (): Promise<{ items: AdcItem[]; sale: AdcSale | null; ready: boolean }> => {
  const supabase = await createClient();
  const [cat, sale] = await Promise.all([supabase.rpc("adc_catalog"), supabase.rpc("adc_sale")]);
  if (cat.error) return { items: [], sale: null, ready: false };
  const items = ((cat.data ?? []) as AdcItem[])
    .map((i) => ({ ...i, list_price: i.list_price === null ? null : Number(i.list_price), sale_price: i.sale_price === null ? null : Number(i.sale_price) }))
    .sort((a, b) => a.cat_sort - b.cat_sort || a.sort - b.sort || a.name.localeCompare(b.name));
  return { items, sale: ((sale.data ?? []) as AdcSale[])[0] ?? null, ready: true };
});

/** Categories in store order, with how many items each has. */
export function adcCategories(items: AdcItem[]) {
  const out: { id: string; name: string; n: number; image: string | null }[] = [];
  for (const i of items) {
    if (!i.category_id) continue;
    const c = out.find((x) => x.id === i.category_id);
    if (c) {
      c.n++;
      if (!c.image && i.image) c.image = i.image;
    } else out.push({ id: i.category_id, name: i.category ?? "Other", n: 1, image: i.image });
  }
  return out;
}

export const adcSlug = (sku: string) => encodeURIComponent(sku);
