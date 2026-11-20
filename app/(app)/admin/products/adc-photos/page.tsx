import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { AfcatPhotos, type AfcatRow } from "../afcat/runner";

export const metadata = { title: "ADC photos from app photos" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = { sku: string; name: string; image_url: string | null; category_id: string | null; categories: { name: string; sort: number } | null };

/** Items with a photo in the app but none on the ADC web store: the ADC version is made from the app's photo. */
export default async function AdcFromAppPhotosPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase
    .from("products")
    .select("sku, name, image_url, category_id, categories(name, sort)")
    .eq("active", true)
    .eq("adc_hide", false)
    .is("adc_image_url", null)
    .like("image_url", "http%")
    .range(0, 1999);
  const list = ((data ?? []) as unknown as Row[]).sort(
    (a, b) => (a.categories?.sort ?? 999) - (b.categories?.sort ?? 999) || a.name.localeCompare(b.name),
  );
  const rows: AfcatRow[] = list.map((p) => ({
    sku: p.sku,
    name: `${p.categories?.name ?? "Other"} · ${p.name}`,
    afcat: p.image_url!,
    ambit: p.image_url,
    adc: null,
  }));
  return (
    <main className="shell wide">
      <TopBar title="ADC photos from app photos" back="/admin/products" />
      <p className="muted small" style={{ margin: 0 }}>
        These items have a photo in the app but none on the ADC web store. For each one you pick, the app makes the ADC version from the app&apos;s
        photo: our own AMBIT photos just trade the AMBIT logo for the ADC logo, and any other photo is trimmed, sharpened and set on white with the
        ADC logo. The app&apos;s photo isn&apos;t changed. Left is the app photo, right is the new ADC photo.
      </p>
      {rows.length ? null : <p className="card2">Every item with an app photo has an ADC photo too.</p>}
      <AfcatPhotos rows={rows} mode="app" />
    </main>
  );
}
