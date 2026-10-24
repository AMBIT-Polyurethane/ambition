import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmployee } from "@/lib/session";
import { saleOn, todayCentral } from "@/lib/sale";
import type { PromoRow, PromoSlide } from "@/lib/promo-themes";
import type { Profile } from "@/lib/types";

export type PromoProduct = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  list_price: number | null;
  customer_priced: boolean | null;
  category_id: string | null;
  sale_price: number | null;
  sale_ends: string | null;
  image_url: string | null;
  active: boolean;
};

/**
 * Turns banner rows into slides. Each row gets a slide, or null when its product
 * is gone from the catalog (Home skips those; the admin editor says why).
 */
export async function toSlides(
  supabase: SupabaseClient,
  rows: PromoRow[],
): Promise<{ slides: (PromoSlide | null)[]; products: Map<string, PromoProduct> }> {
  const today = todayCentral();
  const ids = [...new Set(rows.map((r) => r.product_id).filter((x): x is string => !!x))];
  const needBranches = rows.some((r) => r.kind === "locations");
  const [prodRes, catRes, branchRes] = await Promise.all([
    ids.length
      ? supabase.from("products").select("id, sku, name, unit, list_price, customer_priced, category_id, sale_price, sale_ends, image_url, active").in("id", ids)
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("categories").select("id, customer_priced") : Promise.resolve({ data: [] }),
    needBranches ? supabase.from("branches").select("name, sort").eq("active", true).order("sort") : Promise.resolve({ data: [] }),
  ]);
  const products = new Map(((prodRes.data ?? []) as PromoProduct[]).map((p) => [p.id, p]));
  const catCp = new Map(((catRes.data ?? []) as { id: string; customer_priced: boolean }[]).map((c) => [c.id, c.customer_priced]));
  const cities = ((branchRes.data ?? []) as { name: string }[]).map((b) => b.name);

  const slides = rows.map((r): PromoSlide | null => {
    const base = { id: r.id, kind: r.kind, eyebrow: r.eyebrow, title: r.title, subtitle: r.subtitle, theme: r.theme };
    const link = (r.link ?? "").trim();
    const external = /^https?:\/\//i.test(link);
    if (r.kind === "product") {
      const p = r.product_id ? products.get(r.product_id) : undefined;
      if (!p || !p.active) return null;
      const sale = saleOn(p.sale_price, p.sale_ends, today);
      const list = p.list_price === null ? null : Number(p.list_price);
      const cp = p.customer_priced ?? (p.category_id ? catCp.get(p.category_id) ?? false : false);
      const now = sale ? Number(p.sale_price) : cp ? null : list;
      return {
        ...base,
        title: r.title || p.name,
        image: r.image_url || p.image_url,
        href: link || `/order?q=${encodeURIComponent(p.sku)}`,
        external,
        price: { now, was: sale && list !== null && now !== null && list > now ? list : null, unit: p.unit, sale, account: !sale && cp },
      };
    }
    return {
      ...base,
      image: r.image_url,
      href: link || (r.kind === "locations" ? "/branches" : ""),
      external,
      cities: r.kind === "locations" ? cities : undefined,
    };
  });
  return { slides, products };
}

/** The banner slides this person should see today. Never breaks the home screen: any problem means no banner. */
export async function homePromos(supabase: SupabaseClient, profile: Profile): Promise<PromoSlide[]> {
  try {
    const today = todayCentral();
    const { data, error } = await supabase.from("promos").select("*").eq("active", true).order("sort").order("created_at");
    if (error || !data?.length) return [];
    const audience = isEmployee(profile) ? "employee" : "customer";
    const rows = (data as PromoRow[]).filter(
      (r) =>
        (r.audience === "all" || r.audience === audience) &&
        (!r.starts_on || r.starts_on <= today) &&
        (!r.ends_on || r.ends_on >= today),
    );
    if (!rows.length) return [];
    const { slides } = await toSlides(supabase, rows);
    return slides.filter((s): s is PromoSlide => !!s);
  } catch {
    return [];
  }
}
