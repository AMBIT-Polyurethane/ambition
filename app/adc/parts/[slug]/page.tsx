import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adcCatalog } from "@/lib/adc";
import { diagramBySlug, diagramSkus } from "@/lib/diagrams";
import { AdcDiagram } from "@/components/adc/diagram";
import type { PartInfo } from "@/components/parts-diagram";
import { dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: diagramBySlug(slug)?.title ?? "Parts diagram" };
}

/** A gun's exploded parts drawing, full width. */
export default async function AdcParts({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = diagramBySlug(slug);
  if (!d) notFound();
  const [{ items }, lang] = await Promise.all([adcCatalog(), adcLang()]);
  const t = dict(lang);
  const bySku = new Map(items.map((x) => [x.sku.toLowerCase(), x]));
  const gun = bySku.get(d.forSku.toLowerCase());
  const info: Record<string, PartInfo> = {};
  const images: Record<string, string | null> = {};
  for (const s of diagramSkus(d)) {
    const x = bySku.get(s.toLowerCase());
    if (x) {
      info[s] = { id: x.id, price: x.list_price, sale: x.sale_price, quote: x.quote, msrp: x.msrp };
      images[s] = x.image;
    }
  }
  return (
    <div className="adc-wrap adc-pad adc-stack">
      <nav className="adc-crumbs" aria-label="Breadcrumb">
        <Link href="/adc">{t.homeCrumb}</Link><span aria-hidden="true">›</span>
        {gun ? <><Link href={`/adc/p/${encodeURIComponent(gun.sku)}`}>{gun.name}</Link><span aria-hidden="true">›</span></> : null}
        <span>{t.partsDiagram}</span>
      </nav>
      <div className="adc-sec-h">
        <h1 className="adc-h1">{d.title}</h1>
        <span className="adc-muted">{t.diagramHint}</span>
      </div>
      <AdcDiagram slug={d.slug} info={info} images={images} />
    </div>
  );
}
