import Link from "next/link";
import { Search, Truck } from "lucide-react";
import { adcCatalog, adcCategories } from "@/lib/adc";
import { AdcGrid, AdcImg } from "@/components/adc/grid";

/** ADC home: the hero, the sale, categories with photos, then products. Search and category pick show results instead. */
export default async function AdcHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { items, sale, ready } = await adcCatalog();
  if (!ready) {
    return (
      <div className="adc-wrap adc-pad">
        <h1 className="adc-h1">The store opens soon.</h1>
        <p className="adc-muted">Please check back shortly, or email orders@ambitpu.com.</p>
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
    const title = q ? `Results for “${q}”` : cat ? cat.name : `${sale?.name ?? "Sale"} deals`;
    return (
      <div className="adc-wrap adc-pad">
        <nav className="adc-crumbs" aria-label="Breadcrumb"><Link href="/adc">Home</Link><span aria-hidden="true">›</span><span>{title}</span></nav>
        <div className="adc-sec-h"><h1 className="adc-h1">{title}</h1><span className="adc-muted">{shown.length} {shown.length === 1 ? "item" : "items"}</span></div>
        {cats.length > 1 ? (
          <div className="adc-chips">
            <Link href={q ? `/adc?q=${encodeURIComponent(q)}` : "/adc"} className={!cat ? "on" : undefined}>All</Link>
            {cats.map((c) => (
              <Link key={c.id} href={`/adc?c=${encodeURIComponent(c.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={cat?.id === c.id ? "on" : undefined}>{c.name}</Link>
            ))}
          </div>
        ) : null}
        {shown.length ? <AdcGrid items={shown} sale={sale} /> : (
          <div className="adc-empty"><Search size={28} aria-hidden="true" /><b>Nothing matches that.</b><span>Try a part number, or email orders@ambitpu.com and we&apos;ll find it.</span></div>
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
            <span className="adc-pill"><Truck size={15} aria-hidden="true" /> Ships from 5 AMBIT distribution centers</span>
            <h1>Spray foam guns, parts &amp; supplies.</h1>
            <p>Order online. We ship it straight to your shop or your job site.</p>
            <div className="adc-hero-b">
              {guns ? <Link href={`/adc?c=${encodeURIComponent(guns.id)}`} className="adc-cta">Shop {guns.name.toLowerCase()}</Link> : null}
              <Link href="/adc/parts/st1" className="adc-ghost">Find a part on the gun diagram</Link>
            </div>
          </div>
          {hero ? (
            <Link href={`/adc/p/${encodeURIComponent(hero.sku)}`} className="adc-hero-ph" aria-label={hero.name}><AdcImg src={hero.image} alt={hero.name} /></Link>
          ) : null}
        </div>
      </section>

      <div className="adc-wrap adc-pad adc-stack">
        {sale && onSale.length ? (
          <section aria-label={`${sale.name} deals`} className="adc-stack-s">
            <div className="adc-sec-h"><h2 className="adc-h2">{sale.name} deals</h2><Link href="/adc?sale=1">See all {onSale.length}</Link></div>
            <AdcGrid items={onSale.filter((i) => i.image).slice(0, 8)} sale={sale} />
          </section>
        ) : null}

        <section aria-label="Shop by category" className="adc-stack-s">
          <h2 className="adc-h2">Shop by category</h2>
          <div className="adc-catgrid">
            {cats.map((c) => (
              <Link key={c.id} href={`/adc?c=${encodeURIComponent(c.id)}`} className="adc-cat">
                <AdcImg src={c.image} alt="" />
                <span><b>{c.name}</b><span>{c.n} {c.n === 1 ? "item" : "items"}</span></span>
              </Link>
            ))}
          </div>
        </section>

        {guns && featured.length ? (
          <section aria-label={guns.name} className="adc-stack-s">
            <div className="adc-sec-h"><h2 className="adc-h2">{guns.name}</h2><Link href={`/adc?c=${encodeURIComponent(guns.id)}`}>See all</Link></div>
            <AdcGrid items={featured} sale={sale} />
          </section>
        ) : null}
      </div>
    </>
  );
}
