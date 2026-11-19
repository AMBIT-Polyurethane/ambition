import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Search, Truck } from "lucide-react";
import { adcCatalog, adcCategories } from "@/lib/adc";
import { AdcCartProvider } from "@/components/adc/cart";
import { AdcCartButton, AdcSaleBanner } from "@/components/adc/bits";
import { AdcLogo } from "@/components/adc/logo";

// The ADC web store: AMBIT Distribution Centers. A store of its own: no sign-in, no links into AMBIT Intelligence.
export const metadata: Metadata = {
  title: { default: "ADC · AMBIT Distribution Centers", template: "%s · ADC" },
  description: "Spray foam guns, parts and supplies, shipped from 5 AMBIT distribution centers.",
  applicationName: "ADC",
  appleWebApp: { capable: false, title: "ADC" },
};
export const viewport: Viewport = { themeColor: "#0A0A0B" };
export const dynamic = "force-dynamic";

export default async function AdcLayout({ children }: { children: React.ReactNode }) {
  const { items, sale } = await adcCatalog();
  const cats = adcCategories(items);
  return (
    <AdcCartProvider>
      <div className="adc">
        <header className="adc-head">
          <div className="adc-wrap adc-bar">
            <Link href="/adc" className="adc-logo" aria-label="ADC home"><AdcLogo width={84} /></Link>
            <form action="/adc" className="adc-search" role="search">
              <Search size={18} aria-hidden="true" />
              <input type="search" name="q" placeholder="Search parts, guns and supplies by name or part number" aria-label="Search the store" />
            </form>
            <AdcCartButton />
          </div>
          {cats.length ? (
            <nav className="adc-cats" aria-label="Shop">
              <div className="adc-wrap">
                {cats.map((c) => <Link key={c.id} href={`/adc?c=${encodeURIComponent(c.id)}`}>{c.name}</Link>)}
              </div>
            </nav>
          ) : null}
        </header>
        {sale ? <AdcSaleBanner name={sale.name} endsOn={sale.ends_on} /> : null}
        <main className="adc-main">{children}</main>
        <footer className="adc-foot">
          <div className="adc-wrap adc-foot-in">
            <AdcLogo width={64} />
            <span><Truck size={16} aria-hidden="true" /> Ships from 5 AMBIT distribution centers: Oklahoma City, Arlington, San Marcos, Jacksonville and Mobile.</span>
            <span>Questions? <a href="mailto:orders@ambitpu.com">orders@ambitpu.com</a></span>
            <span className="adc-fine">ADC is a division of AMBIT Polyurethane.</span>
          </div>
        </footer>
      </div>
    </AdcCartProvider>
  );
}
