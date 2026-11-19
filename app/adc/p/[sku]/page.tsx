import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Layers, Truck } from "lucide-react";
import { adcCatalog } from "@/lib/adc";
import { diagramFor, diagramSkus } from "@/lib/diagrams";
import { AdcBuyBox, AdcPrice } from "@/components/adc/bits";
import { AdcGrid, AdcImg, foamNote } from "@/components/adc/grid";
import { AdcDiagram } from "@/components/adc/diagram";
import type { PartInfo } from "@/components/parts-diagram";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const { items } = await adcCatalog();
  const i = items.find((x) => x.sku.toLowerCase() === decodeURIComponent(sku).toLowerCase());
  return { title: i ? `${i.name} (${i.sku})` : "Part" };
}

/** One product: the photo as big as the page allows, the buy box, and for a gun, every part on its exploded diagram. */
export default async function AdcProduct({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const { items, sale } = await adcCatalog();
  const it = items.find((x) => x.sku.toLowerCase() === decodeURIComponent(sku).toLowerCase());
  if (!it) notFound();
  const d = diagramFor(it.sku);
  const bySku = new Map(items.map((x) => [x.sku.toLowerCase(), x]));
  const info: Record<string, PartInfo> = {};
  const images: Record<string, string | null> = {};
  if (d) {
    for (const s of diagramSkus(d)) {
      const x = bySku.get(s.toLowerCase());
      if (x) {
        info[s] = { id: x.id, price: x.list_price, sale: x.sale_price, quote: x.quote };
        images[s] = x.image;
      }
    }
  }
  const parts = d ? diagramSkus(d).map((s) => bySku.get(s.toLowerCase())).filter((x): x is NonNullable<typeof x> => Boolean(x)) : [];
  const more = (parts.length ? parts : items.filter((x) => x.category_id === it.category_id && x.id !== it.id)).filter((x) => x.image).slice(0, 4);
  const note = foamNote(it, sale);

  return (
    <div className="adc-wrap adc-pad adc-stack">
      <nav className="adc-crumbs" aria-label="Breadcrumb">
        <Link href="/adc">Home</Link><span aria-hidden="true">›</span>
        {it.category_id ? <><Link href={`/adc?c=${encodeURIComponent(it.category_id)}`}>{it.category}</Link><span aria-hidden="true">›</span></> : null}
        <span>{it.name}</span>
      </nav>
      <div className="adc-prod">
        <div className="adc-prod-ph"><AdcImg src={it.image} alt={it.name} /></div>
        <div className="adc-prod-b">
          <span className="adc-sku">PART {it.sku}{it.category ? ` · ${it.category.toUpperCase()}` : ""}</span>
          <h1 className="adc-h1">{it.name}</h1>
          <AdcPrice list={it.list_price} sale={it.sale_price} quote={it.quote} big />
          {note ? <span className="adc-promo big">{note}</span> : null}
          {it.quote ? <p className="adc-muted" style={{ margin: 0 }}>Priced per customer. Add it to your order and we&apos;ll confirm your price before anything ships.</p> : null}
          <AdcBuyBox id={it.id} sku={it.sku} name={it.name} image={it.image} quote={it.quote} />
          <div className="adc-ship"><Truck size={22} aria-hidden="true" /><span><b>Ships to your shop or job site</b><span>From one of 5 AMBIT distribution centers</span></span></div>
          <dl className="adc-facts">
            <dt>Part number</dt><dd>{it.sku}</dd>
            {it.category ? <><dt>Category</dt><dd>{it.category}</dd></> : null}
            <dt>Sold as</dt><dd>{(it.unit ?? "each").replace(/^\w/, (c) => c.toUpperCase())}</dd>
            {it.description ? <><dt>Details</dt><dd>{it.description}</dd></> : null}
          </dl>
          {d ? <Link href={`/adc/parts/${d.slug}`} className="adc-ghost dark"><Layers size={18} aria-hidden="true" /> See every part of this gun</Link> : null}
        </div>
      </div>

      {d ? (
        <section className="adc-stack-s" aria-label="Every part">
          <div className="adc-sec-h"><h2 className="adc-h2">Every part, on the drawing</h2><span className="adc-muted">Hover a dot to see the part number. Click it to add it to your cart.</span></div>
          <AdcDiagram slug={d.slug} info={info} images={images} />
        </section>
      ) : null}

      {more.length ? (
        <section className="adc-stack-s" aria-label={d ? "Parts for this gun" : "More like this"}>
          <h2 className="adc-h2">{d ? "Parts for this gun" : "More like this"}</h2>
          <AdcGrid items={more} sale={sale} />
        </section>
      ) : null}
    </div>
  );
}
