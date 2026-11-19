import Link from "next/link";
import { Camera, Tag } from "lucide-react";
import type { AdcItem, AdcSale } from "@/lib/adc";
import { AdcAddButton, AdcPrice } from "@/components/adc/bits";

const href = (sku: string) => `/adc/p/${encodeURIComponent(sku)}`;

/** The ADC photo, or a quiet placeholder (never the AMBIT-logo photo). */
export function AdcImg({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return src ? (
    <img src={src} alt={alt} className={`adc-img${className ? ` ${className}` : ""}`} loading="lazy" decoding="async" />
  ) : (
    <span className={`adc-img empty${className ? ` ${className}` : ""}`} aria-hidden="true"><Camera size={30} /></span>
  );
}

export function foamNote(i: Pick<AdcItem, "quote">, sale: AdcSale | null) {
  return i.quote && sale?.foam_off_per_lb ? `${sale.name}: $${Number(sale.foam_off_per_lb).toFixed(2)} per lb off your price` : null;
}

/** A grid of product cards: big photo, part number, name, price, Add to cart. */
export function AdcGrid({ items, sale }: { items: AdcItem[]; sale: AdcSale | null }) {
  return (
    <div className="adc-grid">
      {items.map((i) => {
        const note = foamNote(i, sale);
        return (
          <div key={i.id} className="adc-card">
            <Link href={href(i.sku)} className="adc-card-ph" aria-label={i.name}>
              <AdcImg src={i.image} alt={i.name} />
              {i.sale_price !== null ? <span className="adc-flag"><Tag size={13} aria-hidden="true" /> {sale?.name ?? "Sale"}</span> : null}
            </Link>
            <div className="adc-card-b">
              <span className="adc-sku">{i.sku}{i.category ? ` · ${i.category.toUpperCase()}` : ""}</span>
              <Link href={href(i.sku)} className="adc-card-n">{i.name}</Link>
              <AdcPrice list={i.list_price} sale={i.sale_price} quote={i.quote} />
              {note ? <span className="adc-promo">{note}</span> : null}
              <AdcAddButton id={i.id} sku={i.sku} name={i.name} image={i.image} label={i.quote ? "Add to quote request" : "Add to cart"} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
