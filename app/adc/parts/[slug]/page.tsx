import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adcCatalog } from "@/lib/adc";
import { diagramBySlug, diagramSkus } from "@/lib/diagrams";
import { AdcDiagram } from "@/components/adc/diagram";
import type { PartInfo } from "@/components/parts-diagram";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: diagramBySlug(slug)?.title ?? "Parts diagram" };
}

/** A gun's exploded parts drawing, full width. */
export default async function AdcParts({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = diagramBySlug(slug);
  if (!d) notFound();
  const { items } = await adcCatalog();
  const bySku = new Map(items.map((x) => [x.sku.toLowerCase(), x]));
  const gun = bySku.get(d.forSku.toLowerCase());
  const info: Record<string, PartInfo> = {};
  const images: Record<string, string | null> = {};
  for (const s of diagramSkus(d)) {
    const x = bySku.get(s.toLowerCase());
    if (x) {
      info[s] = { id: x.id, price: x.list_price, sale: x.sale_price, quote: x.quote };
      images[s] = x.image;
    }
  }
  return (
    <div className="adc-wrap adc-pad adc-stack">
      <nav className="adc-crumbs" aria-label="Breadcrumb">
        <Link href="/adc">Home</Link><span aria-hidden="true">›</span>
        {gun ? <><Link href={`/adc/p/${encodeURIComponent(gun.sku)}`}>{gun.name}</Link><span aria-hidden="true">›</span></> : null}
        <span>Parts diagram</span>
      </nav>
      <div className="adc-sec-h">
        <h1 className="adc-h1">{d.title}</h1>
        <span className="adc-muted">Hover any part to see its number and price. Click it to add it to your cart.</span>
      </div>
      <AdcDiagram slug={d.slug} info={info} images={images} />
    </div>
  );
}
