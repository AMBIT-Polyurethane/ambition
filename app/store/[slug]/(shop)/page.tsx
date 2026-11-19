import Link from "next/link";
import { ArrowRight, Layers, Search, Truck, UserRound } from "lucide-react";
import { catId, getPartner, partnerCatalog, partnerCats, partnerMe, toPItem } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { catName } from "@/lib/adc-i18n";
import { pdict } from "@/lib/partner-i18n";
import { DIAGRAMS } from "@/lib/diagrams";
import { PGrid, PImg } from "@/components/partner/ui";

export default async function PartnerHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const [partner, all, me, lang] = await Promise.all([getPartner(slug), partnerCatalog(slug), partnerMe(slug), adcLang()]);
  if (!partner) return null;
  const t = pdict(lang);
  const base = `/store/${slug}`;
  const items = all.map(toPItem);
  const cats = partnerCats(all);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const cat = cats.find((x) => x.id === sp.c) ?? null;

  if (!items.length) {
    return (
      <div className="adc-wrap adc-pad">
        <div className="adc-empty"><Truck size={28} aria-hidden="true" /><b>{t.soon}</b><span>{t.soonText(partner.phone ?? "")}</span></div>
      </div>
    );
  }

  if (q || cat) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((i) => (!cat || catId(i.category) === cat.id) && words.every((w) => `${i.sku} ${i.name} ${i.category ?? ""}`.toLowerCase().includes(w)));
    const title = q ? t.resultsFor(q) : catName(cat!.name, lang);
    return (
      <div className="adc-wrap adc-pad adc-stack-s">
        <nav className="adc-crumbs" aria-label="Breadcrumb"><Link href={base}>{t.homeCrumb}</Link><span aria-hidden="true">›</span><span>{title}</span></nav>
        <div className="adc-sec-h"><h1 className="adc-h1">{title}</h1><span className="adc-muted">{t.items(shown.length)}</span></div>
        <div className="adc-chips">
          <Link href={q ? `${base}?q=${encodeURIComponent(q)}` : base} className={!cat ? "on" : undefined}>{t.all}</Link>
          {cats.map((x) => <Link key={x.id} href={`${base}?c=${encodeURIComponent(x.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={cat?.id === x.id ? "on" : undefined}>{catName(x.name, lang)}</Link>)}
        </div>
        {shown.length ? <PGrid items={shown} /> : <div className="adc-empty"><Search size={28} aria-hidden="true" /><b>{t.nothing}</b><span>{t.nothingText(partner.phone ?? "")}</span></div>}
      </div>
    );
  }

  const es = lang === "es";
  const heroTitle = (es ? partner.hero_title_es : null) ?? partner.hero_title ?? partner.name;
  const heroText = (es ? partner.hero_text_es : null) ?? partner.hero_text ?? "";
  const tagline = (es ? partner.tagline_es : null) ?? partner.tagline;
  const guns = cats.find((x) => /gun/i.test(x.name)) ?? cats[0];
  const hero = items.find((i) => i.sku === "FX9001" && i.image) ?? items.find((i) => i.image && guns && catId(i.category) === guns.id) ?? items.find((i) => i.image);
  const gun = DIAGRAMS.find((d) => items.some((i) => i.sku.toLowerCase() === d.forSku.toLowerCase()));
  // The three categories with the most photos, eight items each.
  const featured = [...cats]
    .map((c) => ({ c, list: items.filter((i) => catId(i.category) === c.id && i.image) }))
    .filter((x) => x.list.length >= 2)
    .sort((a, b) => b.list.length - a.list.length)
    .slice(0, 3);
  const first = me.kind === "customer" ? (me.name ?? me.customer.contact ?? "").split(/\s+/)[0] : "";
  return (
    <>
      <section className="adc-hero ptn-hero">
        <div className="adc-wrap adc-hero-in">
          <div className="adc-hero-t">
            {tagline ? <span className="adc-pill"><Truck size={15} aria-hidden="true" /> {tagline}</span> : null}
            <h1>{heroTitle}</h1>
            {heroText ? <p>{heroText}</p> : null}
            <div className="adc-hero-b">
              {guns ? <Link href={`${base}?c=${encodeURIComponent(guns.id)}`} className="adc-cta ptn-cta-light">{t.shopCat(catName(guns.name, lang))}</Link> : null}
              {gun ? <Link href={`${base}/p/${encodeURIComponent(gun.forSku)}#parts`} className="adc-ghost"><Layers size={18} aria-hidden="true" /> {t.findOnDiagram}</Link> : null}
            </div>
            {me.kind === "customer" ? <span className="ptn-hi">{t.welcomeBack(first || me.customer.company, me.customer.company)}</span> : null}
          </div>
          {hero ? <Link href={`${base}/p/${encodeURIComponent(hero.sku)}`} className="adc-hero-ph" aria-label={hero.name}><PImg src={hero.image} alt={hero.name} /></Link> : null}
        </div>
      </section>
      <div className="adc-wrap adc-pad adc-stack">
        {me.kind === "guest" ? (
          <Link href={`${base}/signin`} className="ptn-signin-band">
            <UserRound size={22} aria-hidden="true" />
            <span><b>{t.signInBand}</b> {t.signInBandText}</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        ) : null}
        <section className="adc-stack-s" aria-label={t.byCategory}>
          <h2 className="adc-h2">{t.byCategory}</h2>
          <div className="adc-catgrid">
            {cats.map((x) => (
              <Link key={x.id} href={`${base}?c=${encodeURIComponent(x.id)}`} className="adc-cat">
                <PImg src={x.image} alt="" />
                <span><b>{catName(x.name, lang)}</b><span>{t.items(x.n)}</span></span>
              </Link>
            ))}
          </div>
        </section>
        {featured.map(({ c, list }) => (
          <section key={c.id} className="adc-stack-s" aria-label={catName(c.name, lang)}>
            <div className="adc-sec-h"><h2 className="adc-h2">{catName(c.name, lang)}</h2><Link href={`${base}?c=${encodeURIComponent(c.id)}`}>{t.seeAll}</Link></div>
            <PGrid items={list.slice(0, 8)} />
          </section>
        ))}
      </div>
    </>
  );
}
