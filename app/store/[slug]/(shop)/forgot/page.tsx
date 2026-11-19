import { adcLang } from "@/lib/adc-lang";
import { pdict } from "@/lib/partner-i18n";
import { PForgotForm } from "@/components/partner/forms";

export const metadata = { title: "Reset your password" };

export default async function PartnerForgot() {
  const t = pdict(await adcLang());
  return (
    <div className="adc-wrap adc-pad">
      <div className="ptn-signin">
        <h1 className="adc-h1">{t.forgotTitle}</h1>
        <p className="adc-muted" style={{ margin: 0 }}>{t.forgotText}</p>
        <PForgotForm />
      </div>
    </div>
  );
}
