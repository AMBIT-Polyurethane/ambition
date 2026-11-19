import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { adcCatalog, adcCategories } from "@/lib/adc";
import { partnerBySlug } from "@/lib/partners";
import { PartnerProvider, type PItem } from "@/components/partner/store";
import { PartnerFrame } from "@/components/partner/ui";

// A partner's store: the ADC web store's catalog, branded for a distributor AMBIT works with. Preview only (see lib/partners).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = partnerBySlug((await params).slug);
  return {
    title: { default: p?.name ?? "Store", template: `%s · ${p?.name ?? "Store"}` },
    description: p?.tagline,
    robots: { index: false, follow: false },
    appleWebApp: { capable: false, title: p?.short ?? "Store" },
  };
}
export const viewport: Viewport = { themeColor: "#2d694b" };
export const dynamic = "force-dynamic";

export default async function PartnerLayout({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const partner = partnerBySlug((await params).slug);
  if (!partner) notFound();
  const { items } = await adcCatalog();
  const list: PItem[] = items.map((i) => ({ id: i.id, sku: i.sku, name: i.name, image: i.image, list: i.list_price, quote: i.quote, category: i.category, category_id: i.category_id, unit: i.unit }));
  const cats = adcCategories(items).map((c) => ({ id: c.id, name: c.name }));
  return (
    <PartnerProvider partner={partner} items={list}>
      <PartnerFrame cats={cats}>{children}</PartnerFrame>
    </PartnerProvider>
  );
}
