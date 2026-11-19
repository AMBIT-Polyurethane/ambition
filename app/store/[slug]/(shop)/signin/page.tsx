import { redirect } from "next/navigation";
import { getPartner, partnerMe } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { pdict } from "@/lib/partner-i18n";
import { PSignInForm } from "@/components/partner/forms";

export const metadata = { title: "Sign in" };

export default async function PartnerSignIn({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string }> }) {
  const [{ slug }, { next }] = await Promise.all([params, searchParams]);
  const [partner, me, lang] = await Promise.all([getPartner(slug), partnerMe(slug), adcLang()]);
  if (me.kind === "owner" || me.kind === "viewer") redirect(`/store/${slug}/desk`);
  if (me.kind === "customer") redirect(`/store/${slug}/account`);
  const t = pdict(lang);
  return (
    <div className="adc-wrap adc-pad">
      <div className="ptn-signin">
        <h1 className="adc-h1">{t.signInTitle}</h1>
        <p className="adc-muted" style={{ margin: 0 }}>{t.signInText}</p>
        <PSignInForm next={typeof next === "string" ? next.slice(0, 300) : ""} />
        <p className="adc-muted small" style={{ margin: 0 }}>{t.noAccount(partner?.phone ?? "")}</p>
      </div>
    </div>
  );
}
