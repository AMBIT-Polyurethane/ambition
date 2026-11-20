import type { Metadata } from "next";
import { Shirt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AdcNotifyForm } from "@/components/adc/account";
import { AdcImg } from "@/components/adc/grid";
import { dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

export async function generateMetadata(): Promise<Metadata> {
  return { title: dict(await adcLang()).merchTitle };
}

type Merch = { id: string; name: string; description: string | null; price: number | null; image_url: string | null; sizes: string | null };
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** ADC merch: shown as Coming soon (no ordering yet); people can ask to be told when it's ready. */
export default async function AdcMerch() {
  const lang = await adcLang();
  const t = dict(lang);
  const supabase = await createClient();
  const { data } = await supabase.from("merch_items").select("id, name, description, price, image_url, sizes").eq("active", true).order("sort").order("created_at");
  const items = (data ?? []) as Merch[];
  return (
    <div className="adc-wrap adc-pad adc-stack">
      <section className="adc-merch-h">
        <span className="adc-soon">{t.comingSoon.toUpperCase()}</span>
        <h1 className="adc-h1">{t.merchTitle}</h1>
        <p className="adc-muted" style={{ margin: 0 }}>{t.merchSub}</p>
        <div className="adc-merch-n">
          <b>{t.notifyTitle}</b>
          <AdcNotifyForm />
        </div>
      </section>
      {items.length ? (
        <div className="adc-grid">
          {items.map((m) => (
            <div key={m.id} className="adc-card merch">
              <span className="adc-card-ph"><AdcImg src={m.image_url} alt={m.name} /><span className="adc-flag soon">{t.comingSoon}</span></span>
              <div className="adc-card-b">
                <span className="adc-card-n">{m.name}</span>
                {m.price !== null ? <span className="adc-price"><b>{usd(Number(m.price))}</b></span> : null}
                {m.description ? <span className="adc-muted small">{m.description}</span> : null}
                {m.sizes ? <span className="adc-sku">{m.sizes}</span> : null}
                <span className="adc-add off" aria-disabled="true">{t.comingSoon}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="adc-empty"><Shirt size={28} aria-hidden="true" /><b>{t.merchNone}</b></div>
      )}
    </div>
  );
}
