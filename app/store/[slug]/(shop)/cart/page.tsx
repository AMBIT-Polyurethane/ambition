import { partnerCatalog, partnerMe, toPItem } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { pdict } from "@/lib/partner-i18n";
import { PCheckout, type PPrefill } from "@/components/partner/checkout";
import type { PItem } from "@/components/partner/ui";

export const metadata = { title: "Cart" };

export default async function PartnerCart({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [all, me, lang] = await Promise.all([partnerCatalog(slug), partnerMe(slug), adcLang()]);
  const items: Record<string, PItem> = Object.fromEntries(all.map((i) => [i.id, toPItem(i)]));
  const c = me.kind === "customer" ? me.customer : null;
  const prefill: PPrefill =
    me.kind === "customer" && c
      ? { name: me.name ?? c.contact ?? "", company: c.company, email: me.email, phone: c.phone ?? "", street: c.street ?? "", city: c.city ?? "", state: c.state ?? "", zip: c.zip ?? "" }
      : null;
  return (
    <div className="adc-wrap adc-pad adc-stack-s">
      <h1 className="adc-h1">{pdict(lang).yourCart}</h1>
      <PCheckout items={items} prefill={prefill} />
    </div>
  );
}
