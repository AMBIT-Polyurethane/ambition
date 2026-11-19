import { redirect } from "next/navigation";
import { partnerMe } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { pdict } from "@/lib/partner-i18n";
import { PResetForm } from "@/components/partner/forms";

export const metadata = { title: "New password" };

// The link in the reset email signs them in and lands here.
export default async function PartnerReset({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [me, lang] = await Promise.all([partnerMe(slug), adcLang()]);
  if (me.kind === "guest") redirect(`/store/${slug}/forgot`);
  const t = pdict(lang);
  return (
    <div className="adc-wrap adc-pad">
      <div className="ptn-signin">
        <h1 className="adc-h1">{t.newPassword}</h1>
        <PResetForm />
      </div>
    </div>
  );
}
