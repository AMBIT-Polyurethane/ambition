import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { getPartner, partnerMe } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { PartnerProvider, type PWho } from "@/components/partner/ctx";

// A distributor's own store, built on AMBIT Intelligence but walled off from AMBIT (supabase/migrations/0096).
// The shop pages are in (shop); the owner's desk is in desk.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await getPartner((await params).slug);
  return {
    title: { default: p?.name ?? "Store", template: `%s · ${p?.name ?? "Store"}` },
    description: p?.tagline ?? undefined,
    applicationName: p?.name,
    appleWebApp: { capable: false, title: p?.short ?? "Store" },
  };
}
export const viewport: Viewport = { themeColor: "#2d694b" };
export const dynamic = "force-dynamic";

export default async function PartnerLayout({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const [partner, me, lang] = await Promise.all([getPartner(slug), partnerMe(slug), adcLang()]);
  if (!partner) notFound();
  const first = (me.kind !== "guest" ? me.name : null)?.trim().split(/\s+/)[0] ?? null;
  const who: PWho = {
    kind: me.kind,
    first,
    company: me.kind === "customer" ? me.customer.company : null,
    terms: me.kind === "customer" ? me.customer.terms : null,
  };
  const color = /^#[0-9a-f]{6}$/i.test(partner.color) ? partner.color : "#2d694b";
  const color2 = /^#[0-9a-f]{6}$/i.test(partner.color2) ? partner.color2 : color;
  return (
    <PartnerProvider
      store={{
        slug, name: partner.name, short: partner.short, phone: partner.phone ?? "", email: partner.email ?? "", logo: partner.logo_url, color, color2,
        shipFlat: partner.ship_flat === null || partner.ship_flat === undefined ? null : Number(partner.ship_flat),
        shipFreeOver: partner.ship_free_over === null || partner.ship_free_over === undefined ? null : Number(partner.ship_free_over),
        shipNote: partner.ship_note ?? null,
      }}
      lang={lang}
      who={who}
    >
      <div className="adc ptn" lang={lang} style={{ "--p-color": color, "--p-color2": color2 } as React.CSSProperties}>
        {children}
      </div>
    </PartnerProvider>
  );
}
