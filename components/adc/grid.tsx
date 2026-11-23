import Link from "next/link";
import { Camera, Tag } from "lucide-react";
import type { AdcItem, AdcSale } from "@/lib/adc";
import { seasonOf } from "@/lib/adc-season";
import { SeasonChip } from "@/components/adc/season";
import { AdcAddButton, AdcPrice } from "@/components/adc/bits";
import { catName, dict, type Lang } from "@/lib/adc-i18n";

const href = (sku: string) => `/adc/p/${encodeURIComponent(sku)}`;

/** The ADC photo, or a quiet placeholder (never the AMBIT-logo photo). */
export function AdcImg({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return src ? (
    <img src={src} alt={alt} className={`adc-img${className ? ` ${className}` : ""}`} loading="lazy" decoding="async" />
  ) : (
    <span className={`adc-img empty${className ? ` ${className}` : ""}`} aria-hidden="true"><Camera size={30} /></span>
  );
}

export function foamNote(i: Pick<AdcItem, "quote" | "category_id">, sale: AdcSale | null, lang: Lang = "en") {
  return i.quote && i.category_id === "ambit-foam" && sale?.foam_off_per_lb ? dict(lang).foamOff(sale.name, `$${Number(sale.foam_off_per_lb).toFixed(2)}`) : null;
}

/** A grid of product cards: big photo, part number, name, price, Add to cart. */
export function AdcGrid({ items, sale, lang = "en" }: { items: AdcItem[]; sale: AdcSale | null; lang?: Lang }) {
  const t = dict(lang);
  return (
    <div className="adc-grid">
      {items.map((i) => {
        const note = foamNote(i, sale, lang);
        return (
          <div key={i.id} className="adc-card">
            <Link href={href(i.sku)} className="adc-card-ph" aria-label={i.name}>
              <AdcImg src={i.image} alt={i.name} />
              {i.sale_price !== null ? <span className="adc-flag"><Tag size={13} aria-hidden="true" /> {sale?.name ?? t.sale}</span> : null}
              <SeasonChip season={seasonOf(i)} lang={lang} />
            </Link>
            <div className="adc-card-b">
              <span className="adc-sku">{i.sku}{i.category ? ` · ${catName(i.category, lang).toUpperCase()}` : ""}</span>
              <Link href={href(i.sku)} className="adc-card-n">{i.name}</Link>
              {i.is_set ? <span className="adc-set">{t.setBadge}</span> : null}
              <AdcPrice list={i.list_price} sale={i.sale_price} quote={i.quote} msrp={i.msrp} />
              {note ? <span className="adc-promo">{note}</span> : null}
              <AdcAddButton id={i.id} sku={i.sku} name={i.name} image={i.image} quote={i.quote} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
