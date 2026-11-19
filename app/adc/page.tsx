import Link from "next/link";
import { Search, Truck } from "lucide-react";
import { adcCatalog, adcCategories } from "@/lib/adc";
import { AdcGrid, AdcImg } from "@/components/adc/grid";
import { catName, dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

/** ADC home: the hero, the sale, categories with photos, then products. Search and category pick show results instead. */
export default async function AdcHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [{ items, sale, ready }, lang] = await Promise.all([adcCatalog(), adcLang()]);
  const t = dict(lang);
  if (!ready) {
    return (
      <div className="adc-wrap adc-pad">
        <h1 className="adc-h1">{t.soon}</h1>
        <p className="adc-muted">{t.soonText}</p>
      </div>
    );
  }
  const cats = adcCategories(items);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const cat = cats.find((c) => c.id === sp.c) ?? null;
  const onSale = items.filter((i) => i.sale_price !== null);

  if (q || cat || sp.sale === "1") {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter(
      (i) =>
        (!cat || i.category_id === cat.id) &&
        (sp.sale !== "1" || i.sale_price !== null || (sale?.foam_off_per_lb && i.quote)) &&
        words.every((w) => `${i.sku} ${i.name} ${i.description ?? ""} ${i.category ?? ""}`.toLowerCase().includes(w)),
    );
    const title = q ? t.resultsFor(q) : cat ? catName(cat.name, lang) : t.deals(sale?.name ?? t.sale);
    return (
      <div className="adc-wrap adc-pad">
        <nav className="adc-crumbs" aria-label="Breadcrumb"><Link href="/adc">{t.homeCrumb}</Link><span aria-hidden="true">›</span><span>{title}</span></nav>
        <div className="adc-sec-h"><h1 className="adc-h1">{title}</h1><span className="adc-muted">{t.items(shown.length)}</span></div>
        {cats.length > 1 ? (
          <div className="adc-chips">
            <Link href={q ? `/adc?q=${encodeURIComponent(q)}` : "/adc"} className={!cat ? "on" : undefined}>{t.all}</Link>
            {cats.map((c) => (
              <Link key={c.id} href={`/adc?c=${encodeURIComponent(c.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={cat?.id === c.id ? "on" : undefined}>{catName(c.name, lang)}</Link>
            ))}
          </div>
        ) : null}
        {shown.length ? <AdcGrid items={shown} sale={sale} lang={lang} /> : (
          <div className="adc-empty"><Search size={28} aria-hidden="true" /><b>{t.nothing}</b><span>{t.nothingText}</span></div>
        )}
      </div>
    );
  }

  const hero = items.find((i) => i.sku === "FX9001" && i.image) ?? items.find((i) => i.image && i.list_price && i.list_price > 1000) ?? items.find((i) => i.image);
  const guns = cats.find((c) => /gun/i.test(c.name)) ?? cats[0];
  const featured = (guns ? items.filter((i) => i.category_id === guns.id) : items).filter((i) => i.image).slice(0, 8);

  return (
    <>
      <section className="adc-hero">
        <div className="adc-wrap adc-hero-in">
          <div className="adc-hero-t">
            <span className="adc-pill"><Truck size={15} aria-hidden="true" /> {t.heroPill}</span>
            <h1>{t.heroTitle}</h1>
            <p>{t.heroText}</p>
            <div className="adc-hero-b">
              {guns ? <Link href={`/adc?c=${encodeURIComponent(guns.id)}`} className="adc-cta">{t.shopCat(catName(guns.name, lang))}</Link> : null}
              <Link href="/adc/parts/st1" className="adc-ghost">{t.findOnDiagram}</Link>
            </div>
          </div>
          {hero ? (
            <Link href={`/adc/p/${encodeURIComponent(hero.sku)}`} className="adc-hero-ph" aria-label={hero.name}><AdcImg src={hero.image} alt={hero.name} /></Link>
          ) : null}
        </div>
      </section>

      <div className="adc-wrap adc-pad adc-stack">
        {sale && onSale.length ? (
          <section aria-label={t.deals(sale.name)} className="adc-stack-s">
            <div className="adc-sec-h"><h2 className="adc-h2">{t.deals(sale.name)}</h2><Link href="/adc?sale=1">{t.seeAllN(onSale.length)}</Link></div>
            <AdcGrid items={onSale.filter((i) => i.image).slice(0, 8)} sale={sale} lang={lang} />
          </section>
        ) : null}

        <section aria-label={t.byCategory} className="adc-stack-s">
          <h2 className="adc-h2">{t.byCategory}</h2>
          <div className="adc-catgrid">
            {cats.map((c) => (
              <Link key={c.id} href={`/adc?c=${encodeURIComponent(c.id)}`} className="adc-cat">
                <AdcImg src={c.image} alt="" />
                <span><b>{catName(c.name, lang)}</b><span>{t.items(c.n)}</span></span>
              </Link>
            ))}
          </div>
        </section>

        {guns && featured.length ? (
          <section aria-label={catName(guns.name, lang)} className="adc-stack-s">
            <div className="adc-sec-h"><h2 className="adc-h2">{catName(guns.name, lang)}</h2><Link href={`/adc?c=${encodeURIComponent(guns.id)}`}>{t.seeAll}</Link></div>
            <AdcGrid items={featured} sale={sale} lang={lang} />
          </section>
        ) : null}
      </div>
    </>
  );
}
