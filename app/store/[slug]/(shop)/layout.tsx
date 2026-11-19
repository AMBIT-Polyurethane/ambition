import Link from "next/link";
import { Mail, Phone, Search, Truck } from "lucide-react";
import { getPartner, partnerCatalog, partnerCats } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { catName } from "@/lib/adc-i18n";
import { pdict } from "@/lib/partner-i18n";
import { PHeadButtons, PLangSwitch } from "@/components/partner/ui";

// The shop's header (logo, search, language, account, cart, categories) and footer (contact info).
export default async function ShopLayout({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const [partner, items, lang] = await Promise.all([getPartner(slug), partnerCatalog(slug), adcLang()]);
  if (!partner) return null;
  const t = pdict(lang);
  const base = `/store/${slug}`;
  const cats = partnerCats(items);
  const tagline = (lang === "es" ? partner.tagline_es : null) ?? partner.tagline;
  const tel = (partner.phone ?? "").replace(/[^\d+]/g, "");
  return (
    <>
      <header className="adc-head ptn-head">
        <div className="adc-wrap adc-bar">
          <Link href={base} className="adc-logo ptn-logo" aria-label={t.home(partner.name)}>
            {partner.logo_url ? <img src={partner.logo_url} alt={partner.name} /> : <b>{partner.name}</b>}
          </Link>
          <form action={base} className="adc-search" role="search">
            <Search size={18} aria-hidden="true" />
            <input type="search" name="q" placeholder={t.search} aria-label={t.searchLabel} />
          </form>
          <PLangSwitch />
          <PHeadButtons />
        </div>
        {cats.length ? (
          <nav className="adc-cats" aria-label={t.shop}>
            <div className="adc-wrap">{cats.map((c) => <Link key={c.id} href={`${base}?c=${encodeURIComponent(c.id)}`}>{catName(c.name, lang)}</Link>)}</div>
          </nav>
        ) : null}
      </header>
      <main className="adc-main">{children}</main>
      <footer className="adc-foot ptn-foot">
        <div className="adc-wrap adc-foot-in">
          {partner.logo_url ? <img src={partner.logo_url} alt="" className="ptn-foot-logo" /> : <b>{partner.name}</b>}
          {tagline ? <span><Truck size={16} aria-hidden="true" /> {tagline}</span> : null}
          <span className="ptn-contact">
            <span>{t.questions}</span>
            {partner.phone ? <a href={`tel:${tel}`}><Phone size={15} aria-hidden="true" /> {partner.phone}</a> : null}
            {partner.email ? <a href={`mailto:${partner.email}`}><Mail size={15} aria-hidden="true" /> {partner.email}</a> : null}
          </span>
          <span className="adc-fine">{t.powered}</span>
        </div>
      </footer>
    </>
  );
}
