"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Minus, Plus, ShoppingCart } from "lucide-react";
import { useAdcCart } from "@/components/adc/cart";

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Price line: the sale price with the old one crossed out, the list price, or "Request a quote". */
export function AdcPrice({ list, sale, quote, big = false }: { list: number | null; sale: number | null; quote: boolean; big?: boolean }) {
  if (quote || list === null) return <span className={`adc-price quote${big ? " big" : ""}`}>Request a quote</span>;
  if (sale !== null && sale < list) {
    return (
      <span className={`adc-price${big ? " big" : ""}`}>
        <b className="now">{usd(sale)}</b>
        <s>{usd(list)}</s>
        <span className="off">Save {Math.round(((list - sale) / list) * 100)}%</span>
      </span>
    );
  }
  return <span className={`adc-price${big ? " big" : ""}`}><b>{usd(list)}</b></span>;
}

/** The cart button in the header, with the count and a short "Added" note. */
export function AdcCartButton() {
  const { count, flash, ready } = useAdcCart();
  return (
    <span className="adc-cartwrap">
      <Link href="/adc/cart" className="adc-cartbtn" aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}>
        <ShoppingCart size={20} aria-hidden="true" />
        {ready && count ? <span className="adc-badge">{count > 99 ? "99+" : count}</span> : null}
      </Link>
      {flash ? (
        <span className="adc-flash" role="status">
          <Check size={14} strokeWidth={3} aria-hidden="true" /> Added: {flash.length > 40 ? `${flash.slice(0, 40)}...` : flash}
        </span>
      ) : null}
    </span>
  );
}

/** "Add to cart" on a product card. */
export function AdcAddButton({ id, sku, name, image, label = "Add to cart" }: { id: string; sku: string; name: string; image: string | null; label?: string }) {
  const { add } = useAdcCart();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={`adc-add${done ? " done" : ""}`}
      onClick={() => {
        add({ id, sku, name, image }, 1);
        setDone(true);
      }}
    >
      {done ? <><Check size={17} strokeWidth={3} /> Added</> : label}
    </button>
  );
}

/** The product page's quantity and Add to cart. */
export function AdcBuyBox({ id, sku, name, image, quote }: { id: string; sku: string; name: string; image: string | null; quote: boolean }) {
  const { add } = useAdcCart();
  const [qty, setQty] = useState(1);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <div className="adc-buy">
      <div className="adc-qty" role="group" aria-label="Quantity">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less"><Minus size={18} /></button>
        <input inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(9999, Number(e.target.value.replace(/\D/g, "")) || 1)))} aria-label="Quantity" />
        <button type="button" onClick={() => setQty((q) => Math.min(9999, q + 1))} aria-label="More"><Plus size={18} /></button>
      </div>
      <button
        type="button"
        className={`adc-cta${done ? " done" : ""}`}
        onClick={() => {
          add({ id, sku, name, image }, qty);
          setDone(true);
        }}
      >
        {done ? <><Check size={19} strokeWidth={3} /> Added to cart</> : quote ? "Add to quote request" : "Add to cart"}
      </button>
    </div>
  );
}

/** Black Friday: the banner with a live countdown to the last day (11:59 PM Central). */
export function AdcSaleBanner({ name, endsOn }: { name: string; endsOn: string }) {
  const end = new Date(`${endsOn}T23:59:59-06:00`).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now === null ? null : Math.max(0, end - now);
  const parts = left === null ? null : [Math.floor(left / 86400000), Math.floor(left / 3600000) % 24, Math.floor(left / 60000) % 60, Math.floor(left / 1000) % 60];
  const endText = new Date(`${endsOn}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <Link href="/adc?sale=1" className="adc-sale">
      <span className="adc-sale-tag">{name.toUpperCase()}</span>
      <span className="adc-sale-t"><b>{name} prices are live.</b> <span>Ends {endText}.</span></span>
      {parts ? (
        <span className="adc-clock" aria-label={`${parts[0]} days ${parts[1]} hours left`}>
          {[["d", parts[0]], ["h", parts[1]], ["m", parts[2]], ["s", parts[3]]].map(([u, v]) => (
            <span key={u as string}><b>{String(v).padStart(2, "0")}</b>{u}</span>
          ))}
        </span>
      ) : null}
      <span className="adc-sale-go">Shop the sale</span>
    </Link>
  );
}
