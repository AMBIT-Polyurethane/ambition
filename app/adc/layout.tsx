import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Search, Truck, UserRound } from "lucide-react";
import { adcCatalog, adcCategories } from "@/lib/adc";
import { AdcCartProvider } from "@/components/adc/cart";
import { AdcCartButton, AdcSaleBanner } from "@/components/adc/bits";
import { AdcLogo } from "@/components/adc/logo";
import { AdcLangProvider, AdcLangSwitch } from "@/components/adc/lang";
import { catName, dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";
import { adcMyPrices } from "@/lib/adc-me";
import { AdcMyPricesProvider } from "@/components/adc/my-prices";

// The ADC web store: AMBIT Distribution Centers. A store of its own: no sign-in, no links into AMBIT Intelligence.
export async function generateMetadata(): Promise<Metadata> {
  const es = (await adcLang()) === "es";
  return {
    title: { default: "ADC · AMBIT Distribution Centers", template: "%s · ADC" },
    description: es ? "Pistolas, repuestos y suministros de espuma en spray, enviados desde 5 centros de distribución AMBIT." : "Spray foam guns, parts and supplies, shipped from 5 AMBIT distribution centers.",
    applicationName: "ADC",
    appleWebApp: { capable: false, title: "ADC" },
  };
}
export const viewport: Viewport = { themeColor: "#0A0A0B" };
export const dynamic = "force-dynamic";

export default async function AdcLayout({ children }: { children: React.ReactNode }) {
  const [{ items, sale }, lang, mine] = await Promise.all([adcCatalog(), adcLang(), adcMyPrices()]);
  const cats = adcCategories(items);
  const t = dict(lang);
  return (
    <AdcLangProvider lang={lang}>
    <AdcMyPricesProvider value={mine}>
    <AdcCartProvider>
      <div className="adc" lang={lang}>
        <header className="adc-head">
          <div className="adc-wrap adc-bar">
            <Link href="/adc" className="adc-logo" aria-label={t.home}><AdcLogo width={84} /></Link>
            <form action="/adc" className="adc-search" role="search">
              <Search size={18} aria-hidden="true" />
              <input type="search" name="q" placeholder={t.search} aria-label={t.searchLabel} />
            </form>
            <AdcLangSwitch />
            <Link href="/adc/account" className="adc-acct" aria-label={t.account}><UserRound size={19} aria-hidden="true" /><span>{t.account}</span></Link>
            <AdcCartButton />
          </div>
          {cats.length ? (
            <nav className="adc-cats" aria-label={t.shop}>
              <div className="adc-wrap">
                <Link href="/adc/merch" className="adc-cat-merch">{t.merch} <span className="adc-soon sm">{t.comingSoon}</span></Link>
                {cats.map((c) => <Link key={c.id} href={`/adc?c=${encodeURIComponent(c.id)}`}>{catName(c.name, lang)}</Link>)}
              </div>
            </nav>
          ) : null}
        </header>
        {sale ? <AdcSaleBanner name={sale.name} endsOn={sale.ends_on} /> : null}
        <main className="adc-main">{children}</main>
        <footer className="adc-foot">
          <div className="adc-wrap adc-foot-in">
            <AdcLogo width={64} />
            <span><Truck size={16} aria-hidden="true" /> {t.ships5}</span>
            <span>{t.questions} <a href="mailto:orders@ambitpu.com">orders@ambitpu.com</a></span>
            <span className="adc-foot-links"><Link href="/adc/account">{t.rewards}</Link><Link href="/adc/merch">{t.merch}</Link><Link href="/adc/policies">{t.policies}</Link></span>
            <span className="adc-fine">{t.division}</span>
          </div>
        </footer>
      </div>
    </AdcCartProvider>
    </AdcMyPricesProvider>
    </AdcLangProvider>
  );
}
