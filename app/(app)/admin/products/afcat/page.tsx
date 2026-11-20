import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { AFCAT_BASE, AFCAT_PHOTOS } from "@/lib/supplier-photos";
import { AfcatPhotos, type AfcatRow } from "./runner";

export const metadata = { title: "Photos from AFCAT" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Items we sell that AFCAT also carries, with no photo of our own yet: AFCAT's photo, dressed with our badges. */
export default async function AfcatPhotosPage() {
  const { supabase } = await requireAdmin();
  const skus = AFCAT_PHOTOS.map(([s]) => s);
  const { data } = await supabase.from("products").select("sku, name, image_url, adc_image_url").in("sku", skus);
  const bySku = new Map(((data ?? []) as { sku: string; name: string; image_url: string | null; adc_image_url: string | null }[]).map((p) => [p.sku, p]));
  const rows: AfcatRow[] = AFCAT_PHOTOS.filter(([s]) => bySku.has(s)).map(([sku, path]) => {
    const p = bySku.get(sku)!;
    const done = Boolean(p.adc_image_url && /\/adc\//.test(p.adc_image_url));
    return { sku, name: p.name, afcat: AFCAT_BASE + path, ambit: p.image_url, adc: done ? p.adc_image_url : null };
  });
  return (
    <main className="shell wide">
      <TopBar title="Photos from AFCAT" back="/admin/products" />
      <p className="muted small" style={{ margin: 0 }}>
        AFCAT gave AMBIT written permission to reuse their product photos. For each item below, the app takes AFCAT&apos;s photo, trims it, enlarges and
        sharpens it, sets it on white with a soft shadow, and saves two versions: one with the AMBIT logo (the app) and one with the ADC logo (the web store).
      </p>
      <AfcatPhotos rows={rows} />
    </main>
  );
}
