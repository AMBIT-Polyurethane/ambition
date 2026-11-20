import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createAnon } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";

/** How an item gets to the customer: parcel, freight, pick up only, or pick up / a full truckload (fiberglass). */
export type ShipMode = "parcel" | "freight" | "pickup" | "truckload";

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
  ship: ShipMode;
  truck_qty: number | null;
  /** Spray foam sold as a set: 1 ISO A-side + 1 of this B-side. */
  is_set: boolean;
};
export type AdcSale = { slug: string; name: string; starts_on: string; ends_on: string; foam_off_per_lb: number | null };

/** The tag the sale sheet and product edits refresh, so the store shows changes right away. */
export const ADC_CATALOG_TAG = "adc-catalog";

// The catalog is the same for every shopper, so the store reads it once a minute for everyone instead of once per
// page view per person (a big Black Friday post can't overload the database this way). No sign-in is used here.
const loadCatalog = unstable_cache(
  async (): Promise<{ items: AdcItem[]; sale: AdcSale | null; ready: boolean }> => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return { items: [], sale: null, ready: false };
    const supabase = createAnon(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const [cat, sale] = await Promise.all([supabase.rpc("adc_catalog"), supabase.rpc("adc_sale")]);
    // A failed read throws, so it isn't kept: the next page view tries again.
    if (cat.error) throw new Error(cat.error.message);
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const items = ((cat.data ?? []) as AdcItem[])
      .map((i) => ({ ...i, list_price: n(i.list_price), sale_price: n(i.sale_price), truck_qty: n(i.truck_qty), ship: (i.ship ?? "parcel") as ShipMode, is_set: Boolean(i.is_set) }))
      .sort((a, b) => a.cat_sort - b.cat_sort || a.sort - b.sort || a.name.localeCompare(b.name));
    return { items, sale: ((sale.data ?? []) as AdcSale[])[0] ?? null, ready: true };
  },
  ["adc-catalog-v2"],
  { revalidate: 60, tags: [ADC_CATALOG_TAG] },
);

/** The whole store, once per page load (the header, the page and the cart all share it). */
export const adcCatalog = cache(async (): Promise<{ items: AdcItem[]; sale: AdcSale | null; ready: boolean }> => {
  try {
    return await loadCatalog();
  } catch {
    return { items: [], sale: null, ready: false };
  }
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

export { seasonOf, type Season } from "@/lib/adc-season";

export type AdcDoc = { title: string; doc_type: string; revision: string | null; url: string };
export type AdcExtras = { gallery: string[]; docs: AdcDoc[] };

const loadExtras = unstable_cache(
  async (sku: string): Promise<AdcExtras> => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return { gallery: [], docs: [] };
    const supabase = createAnon(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.rpc("adc_product_extras", { p_sku: sku });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as Partial<AdcExtras>;
    return { gallery: (d.gallery ?? []).filter(Boolean), docs: d.docs ?? [] };
  },
  ["adc-extras-v1"],
  { revalidate: 300, tags: [ADC_CATALOG_TAG] },
);

/** A product's extra photos (data sheet pages for spray foam) and its public documents (TDS, SDS, code reports...). */
export async function adcProductExtras(sku: string): Promise<AdcExtras> {
  try {
    return await loadExtras(sku);
  } catch {
    return { gallery: [], docs: [] };
  }
}
