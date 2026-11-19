import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { getPartner, partnerMe } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { pdict } from "@/lib/partner-i18n";

export const metadata = { title: "Order received" };

export default async function PartnerThanks({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ n?: string }> }) {
  const [{ slug }, { n }] = await Promise.all([params, searchParams]);
  const [partner, me, lang] = await Promise.all([getPartner(slug), partnerMe(slug), adcLang()]);
  const t = pdict(lang);
  const no = (n ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 20);
  return (
    <div className="adc-wrap adc-pad">
      <div className="adc-thanks">
        <CircleCheck size={44} aria-hidden="true" className="ptn-ok-ic" />
        <span className="adc-sku">{t.orderReceived.toUpperCase()}</span>
        <h1 className="adc-h1">{t.gotIt(no)}</h1>
        <p className="adc-muted">{t.gotItText}</p>
        {partner?.phone ? <p className="adc-muted small">{partner.name} · {partner.phone}{partner.email ? ` · ${partner.email}` : ""}</p> : null}
        <div className="adc-hero-b" style={{ justifyContent: "center" }}>
          <Link href={`/store/${slug}`} className="adc-cta">{t.keepShopping}</Link>
          {me.kind === "customer" ? <Link href={`/store/${slug}/account`} className="adc-ghost dark">{t.seeOrders}</Link> : null}
        </div>
      </div>
    </div>
  );
}
