import { CircleCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

/** The unsubscribe link in every ADC promo email. */
export default async function AdcUnsubscribe({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t: token } = await searchParams;
  const t = dict(await adcLang());
  let email: string | null = null;
  if (token && /^[0-9a-f-]{36}$/i.test(token)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("adc_promo_unsubscribe", { p_token: token });
    email = (data as string | null) ?? null;
  }
  return (
    <div className="adc-wrap adc-pad">
      <div className="adc-thanks">
        {email ? <><CircleCheck size={44} aria-hidden="true" /><p>{t.unsubDone(email)}</p></> : <p>{t.unsubBad}</p>}
      </div>
    </div>
  );
}
