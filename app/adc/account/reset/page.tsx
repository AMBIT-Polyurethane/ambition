import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdcResetForm } from "@/components/adc/account";
import { dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

export const metadata = { title: "Reset password", robots: { index: false } };

// The link in the reset email signs them in and lands here.
export default async function AdcReset() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/adc/account");
  const t = dict(await adcLang());
  return (
    <div className="adc-wrap adc-pad">
      <div className="adc-acct-box">
        <h1 className="adc-h1">{t.newPassword}</h1>
        <AdcResetForm />
      </div>
    </div>
  );
}
