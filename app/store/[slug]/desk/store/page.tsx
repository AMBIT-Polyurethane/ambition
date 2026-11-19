import { getPartner, partnerMe } from "@/lib/partner-store";
import { DeskStore } from "@/components/partner/desk-store";

export const metadata = { title: "Store look & contact" };

export default async function DeskStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [p, me] = await Promise.all([getPartner(slug), partnerMe(slug)]);
  if (!p) return null;
  return (
    <DeskStore
      slug={slug}
      readOnly={me.kind !== "owner"}
      s={{
        name: p.name, short: p.short, owner_name: p.owner_name ?? "", email: p.email ?? "", phone: p.phone ?? "", logo_url: p.logo_url,
        color: p.color, color2: p.color2, tagline: p.tagline ?? "", hero_title: p.hero_title ?? "", hero_text: p.hero_text ?? "",
        tagline_es: p.tagline_es ?? "", hero_title_es: p.hero_title_es ?? "", hero_text_es: p.hero_text_es ?? "",
      }}
    />
  );
}
