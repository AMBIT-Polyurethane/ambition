import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Layers, Truck } from "lucide-react";
import { adcCatalog, adcProductExtras, seasonOf } from "@/lib/adc";
import { AdcGallery } from "@/components/adc/gallery";
import { diagramFor, diagramSkus } from "@/lib/diagrams";
import { AdcBuyBox, AdcPrice } from "@/components/adc/bits";
import { AdcGrid, foamNote } from "@/components/adc/grid";
import { SeasonChip } from "@/components/adc/season";
import { AdcDiagram } from "@/components/adc/diagram";
import type { PartInfo } from "@/components/parts-diagram";
import { catName, dict, unitName } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const { items } = await adcCatalog();
  const i = items.find((x) => x.sku.toLowerCase() === decodeURIComponent(sku).toLowerCase());
  return { title: i ? `${i.name} (${i.sku})` : "Part" };
}

/** One product: the photo as big as the page allows, the buy box, and for a gun, every part on its exploded diagram. */
export default async function AdcProduct({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const [{ items, sale }, lang] = await Promise.all([adcCatalog(), adcLang()]);
  const t = dict(lang);
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
  const note = foamNote(it, sale, lang);
  const extras = await adcProductExtras(it.sku);
  const photos = [it.image, ...extras.gallery].filter((x): x is string => Boolean(x));
  const ORDER = ["TDS", "SDS", "CCRR", "ESR", "Guide", "Warranty", "Certificate"];
  const docs = [...extras.docs].sort((a, b) => (ORDER.indexOf(a.doc_type) + 99) % 99 - (ORDER.indexOf(b.doc_type) + 99) % 99 || a.title.localeCompare(b.title));

  return (
    <div className="adc-wrap adc-pad adc-stack">
      <nav className="adc-crumbs" aria-label="Breadcrumb">
        <Link href="/adc">{t.homeCrumb}</Link><span aria-hidden="true">›</span>
        {it.category_id ? <><Link href={`/adc?c=${encodeURIComponent(it.category_id)}`}>{catName(it.category, lang)}</Link><span aria-hidden="true">›</span></> : null}
        <span>{it.name}</span>
      </nav>
      <div className="adc-prod">
        <AdcGallery images={photos} alt={it.name}>
          <SeasonChip season={seasonOf(it)} lang={lang} big />
        </AdcGallery>
        <div className="adc-prod-b">
          <span className="adc-sku">{t.part} {it.sku}{it.category ? ` · ${catName(it.category, lang).toUpperCase()}` : ""}</span>
          <h1 className="adc-h1">{it.name}</h1>
          {it.is_set ? <span className="adc-set big">{t.setBadge}</span> : null}
          <AdcPrice list={it.list_price} sale={it.sale_price} quote={it.quote} big />
          {note ? <span className="adc-promo big">{note}</span> : null}
          {it.quote ? <p className="adc-muted" style={{ margin: 0 }}>{t.perCustomer}</p> : null}
          {it.is_set ? <p className="adc-muted" style={{ margin: 0 }}>{t.setNote(unitName(it.unit, lang).toLowerCase())}</p> : null}
          <AdcBuyBox id={it.id} sku={it.sku} name={it.name} image={it.image} quote={it.quote} />
          <div className={`adc-ship ${it.ship}`}>
            <Truck size={22} aria-hidden="true" />
            <span>
              <b>{it.ship === "pickup" ? t.shipPickup : it.ship === "truckload" ? t.shipTruck : it.ship === "freight" ? t.shipFreight : t.shipParcel}</b>
              <span>{it.ship === "truckload" && it.truck_qty ? t.truckHolds(`${it.truck_qty.toLocaleString("en-US")} ${unitName(it.unit, lang).toLowerCase()}`) : t.shipDisclaimer}</span>
            </span>
          </div>
          <dl className="adc-facts">
            <dt>{t.partNo}</dt><dd>{it.sku}</dd>
            {it.category ? <><dt>{t.category}</dt><dd>{catName(it.category, lang)}</dd></> : null}
            <dt>{t.soldAs}</dt><dd>{it.is_set ? t.setBadge : unitName(it.unit, lang)}</dd>
            {it.description ? <><dt>{t.details}</dt><dd>{it.description}</dd></> : null}
          </dl>
          {d ? <Link href={`/adc/parts/${d.slug}`} className="adc-ghost dark"><Layers size={18} aria-hidden="true" /> {t.seeEveryPart}</Link> : null}
        </div>
      </div>

      {docs.length ? (
        <section className="adc-stack-s" aria-label={t.docsTitle}>
          <div className="adc-sec-h"><h2 className="adc-h2">{t.docsTitle}</h2><span className="adc-muted">{t.docsHint}</span></div>
          <div className="adc-docs">
            {docs.map((doc) => (
              <a key={doc.url} href={doc.url} target="_blank" rel="noopener noreferrer" className={`adc-doc t-${doc.doc_type.toLowerCase()}`}>
                <span className="adc-doc-ic" aria-hidden="true"><FileText size={20} /></span>
                <span className="adc-doc-b">
                  <span className="adc-doc-k">{t.docType(doc.doc_type)}</span>
                  <b>{doc.title}</b>
                  {doc.revision ? <span className="adc-muted small">{doc.revision}</span> : null}
                </span>
                <span className="adc-doc-go">{t.openPdf}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {d ? (
        <section className="adc-stack-s" aria-label={t.everyPart}>
          <div className="adc-sec-h"><h2 className="adc-h2">{t.everyPart}</h2><span className="adc-muted">{t.everyPartHint}</span></div>
          <AdcDiagram slug={d.slug} info={info} images={images} />
        </section>
      ) : null}

      {more.length ? (
        <section className="adc-stack-s" aria-label={d ? t.partsForGun : t.moreLike}>
          <h2 className="adc-h2">{d ? t.partsForGun : t.moreLike}</h2>
          <AdcGrid items={more} sale={sale} lang={lang} />
        </section>
      ) : null}
    </div>
  );
}
