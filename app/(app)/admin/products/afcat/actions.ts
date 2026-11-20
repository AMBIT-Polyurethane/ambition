"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { ADC_CATALOG_TAG } from "@/lib/adc";
import { AFCAT_BASE, AFCAT_PHOTOS, brandPhoto, fetchPhoto, photoSlug } from "@/lib/supplier-photos";

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
