import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageCheck, Truck } from "lucide-react";
import { catId, partnerCatalog, toPItem } from "@/lib/partner-store";
import { diagramFor, diagramSkus } from "@/lib/diagrams";
import { adcLang } from "@/lib/adc-lang";
import { catName, unitName } from "@/lib/adc-i18n";
import { pdict } from "@/lib/partner-i18n";
import { PBuy, PDiagram, PGrid, PImg, PPrice } from "@/components/partner/ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; sku: string }> }): Promise<Metadata> {
  const { slug, sku } = await params;
  const i = (await partnerCatalog(slug)).find((x) => x.sku.toLowerCase() === decodeURIComponent(sku).toLowerCase());
  return { title: i ? `${i.name} (${i.sku})` : "Part" };
}

/** One product: the big photo, the buy box, and for a gun, every part on its drawing. */
export default async function PartnerProduct({ params }: { params: Promise<{ slug: string; sku: string }> }) {
  const { slug, sku } = await params;
  const [all, lang] = await Promise.all([partnerCatalog(slug), adcLang()]);
  const t = pdict(lang);
  const base = `/store/${slug}`;
  const it = all.find((x) => x.sku.toLowerCase() === decodeURIComponent(sku).toLowerCase());
  if (!it) notFound();
  const items = all.map(toPItem);
  const item = toPItem(it);
  const d = diagramFor(it.sku);
  const bySku = new Map(items.map((x) => [x.sku.toLowerCase(), x]));
  const parts = d ? diagramSkus(d).map((s) => bySku.get(s.toLowerCase())).filter((x): x is NonNullable<typeof x> => Boolean(x)) : [];
  const more = (parts.length ? parts : items.filter((x) => catId(x.category) === catId(it.category) && x.id !== it.id)).filter((x) => x.image).slice(0, 4);
  return (
    <div className="adc-wrap adc-pad adc-stack">
      <nav className="adc-crumbs" aria-label="Breadcrumb">
        <Link href={base}>{t.homeCrumb}</Link><span aria-hidden="true">›</span>
        {it.category ? <><Link href={`${base}?c=${encodeURIComponent(catId(it.category))}`}>{catName(it.category, lang)}</Link><span aria-hidden="true">›</span></> : null}
        <span>{it.name}</span>
      </nav>
      <div className="adc-prod">
        <div className="adc-prod-ph"><PImg src={it.image} alt={it.name} /></div>
        <div className="adc-prod-b">
          <span className="adc-sku">{t.part} {it.sku}{it.category ? ` · ${catName(it.category, lang).toUpperCase()}` : ""}</span>
          <h1 className="adc-h1">{it.name}</h1>
          <PPrice item={item} big />
          {it.basis === "lb" ? <p className="adc-muted" style={{ margin: 0 }}>{t.perCustomerNote}</p> : null}
          {it.in_stock !== null ? (
            <span className={`ptn-stock${it.in_stock ? " in" : ""}`}><PackageCheck size={16} aria-hidden="true" /> {it.in_stock ? t.inStock : t.outOfStock}</span>
          ) : null}
          <PBuy item={item} />
          <div className="adc-ship"><Truck size={22} aria-hidden="true" /><span><b>{t.shipsTitle}</b><span>{t.shipsSub}</span></span></div>
          <dl className="adc-facts">
            <dt>{t.partNo}</dt><dd>{it.sku}</dd>
            {it.category ? <><dt>{t.category}</dt><dd>{catName(it.category, lang)}</dd></> : null}
            <dt>{t.soldAs}</dt><dd>{unitName(it.unit, lang)}</dd>
            {it.description ? <><dt>{t.details}</dt><dd>{it.description}</dd></> : null}
          </dl>
        </div>
      </div>
      {d ? (
        <section className="adc-stack-s" aria-label={t.everyPart} id="parts">
          <div className="adc-sec-h"><h2 className="adc-h2">{t.everyPart}</h2><span className="adc-muted">{t.everyPartHint}</span></div>
          <PDiagram slug={d.slug} items={parts.length ? parts : items} />
        </section>
      ) : null}
      {more.length ? (
        <section className="adc-stack-s" aria-label={d ? t.partsForGun : t.moreLike}>
          <h2 className="adc-h2">{d ? t.partsForGun : t.moreLike}</h2>
          <PGrid items={more} />
        </section>
      ) : null}
    </div>
  );
}
