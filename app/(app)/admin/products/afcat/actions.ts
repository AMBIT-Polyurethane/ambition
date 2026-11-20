"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { ADC_CATALOG_TAG } from "@/lib/adc";
import { AFCAT_BASE, AFCAT_PHOTOS, adcFromAppPhoto, brandPhoto, fetchOwnPhoto, fetchPhoto, photoSlug } from "@/lib/supplier-photos";

export type BrandResult = { sku: string; ok: boolean; error?: string; ambit?: string; adc?: string };

/** Admin → Products → Photos from AFCAT: grabs each item's AFCAT photo, makes the AMBIT and ADC versions and saves both. */
export async function brandAfcatPhotos(skus: string[]): Promise<BrandResult[]> {
  const { supabase } = await requireAdmin();
  const map = new Map(AFCAT_PHOTOS);
  const out: BrandResult[] = [];
  for (const sku of skus.slice(0, 6)) {
    const path = map.get(sku);
    if (!path) {
      out.push({ sku, ok: false, error: "No AFCAT photo for this item" });
      continue;
    }
    try {
      const src = await fetchPhoto(AFCAT_BASE + path);
      const { ambit, adc } = await brandPhoto(src);
      const slug = photoSlug(sku);
      const v = Date.now();
      const urls: Record<"p" | "adc", string> = { p: "", adc: "" };
      for (const [folder, buf] of [["p", ambit], ["adc", adc]] as const) {
        const file = `${folder}/${slug}.jpg`;
        const { error } = await supabase.storage.from("product-images").upload(file, buf, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
        if (error) throw new Error(`Saving the photo failed: ${error.message}`);
        urls[folder] = `${supabase.storage.from("product-images").getPublicUrl(file).data.publicUrl}?v=${v}`;
      }
      const { error } = await supabase.from("products").update({ image_url: urls.p, adc_image_url: urls.adc }).eq("sku", sku);
      if (error) throw new Error(error.message);
      out.push({ sku, ok: true, ambit: urls.p, adc: urls.adc });
    } catch (e) {
      out.push({ sku, ok: false, error: (e as Error).message || "Something went wrong" });
    }
  }
  revalidateTag(ADC_CATALOG_TAG);
  revalidatePath("/adc", "layout");
  revalidatePath("/admin/products");
  return out;
}

/**
 * Admin → Products → ADC photos from app photos: an item with a photo in the app but none on the web store gets an
 * ADC version of that photo (our own AMBIT photos just trade the AMBIT oval for the ADC wordmark). The app photo stays as it is.
 */
export async function adcFromAppPhotos(skus: string[]): Promise<BrandResult[]> {
  const { supabase } = await requireAdmin();
  const list = skus.slice(0, 6);
  const { data } = await supabase.from("products").select("sku, image_url, adc_image_url").in("sku", list);
  const bySku = new Map(((data ?? []) as { sku: string; image_url: string | null; adc_image_url: string | null }[]).map((p) => [p.sku, p]));
  const out: BrandResult[] = [];
  for (const sku of list) {
    const p = bySku.get(sku);
    if (!p?.image_url || !/^https?:\/\//.test(p.image_url)) {
      out.push({ sku, ok: false, error: "This item has no app photo to start from" });
      continue;
    }
    if (p.adc_image_url) {
      out.push({ sku, ok: true, adc: p.adc_image_url });
      continue;
    }
    try {
      const { adc } = await adcFromAppPhoto(await fetchOwnPhoto(p.image_url));
      const file = `adc/${photoSlug(sku)}.jpg`;
      const { error: ue } = await supabase.storage.from("product-images").upload(file, adc, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
      if (ue) throw new Error(`Saving the photo failed: ${ue.message}`);
      const url = `${supabase.storage.from("product-images").getPublicUrl(file).data.publicUrl}?v=${Date.now()}`;
      // Only fills an empty ADC photo: a photo someone added meanwhile is kept.
      const { error } = await supabase.from("products").update({ adc_image_url: url }).eq("sku", sku).is("adc_image_url", null);
      if (error) throw new Error(error.message);
      out.push({ sku, ok: true, adc: url });
    } catch (e) {
      out.push({ sku, ok: false, error: (e as Error).message || "Something went wrong" });
    }
  }
  revalidateTag(ADC_CATALOG_TAG);
  revalidatePath("/adc", "layout");
  revalidatePath("/admin/products");
  return out;
}
