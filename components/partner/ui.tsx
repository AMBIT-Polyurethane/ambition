"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Camera, Check, Minus, Plus, ShoppingCart, UserRound } from "lucide-react";
import { PartsDiagram, type PartInfo } from "@/components/parts-diagram";
import { diagramBySlug } from "@/lib/diagrams";
import { catName } from "@/lib/adc-i18n";
import { usePartner, usd } from "@/components/partner/ctx";

/** The item fields a shopper's page needs (what partner_catalog() returns). */
export type PItem = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string | null;
  image: string | null;
  price: number | null;
  my_price: number | null;
  per_customer: boolean;
  basis: "unit" | "lb";
  in_stock: boolean | null;
  /** The maker's MSRP is the public price (Graco / Binks); signed-in customers see their own. */
  msrp?: boolean;
};

/** Spray foam (per lb) and items with no price are added to the order and priced before it ships. */
export const isQuote = (i: Pick<PItem, "basis" | "price" | "my_price">) => i.basis === "lb" || (i.my_price ?? i.price) === null;
export const linePrice = (i: Pick<PItem, "basis" | "price" | "my_price">) => (i.basis === "lb" ? null : i.my_price ?? i.price);

export function PImg({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return src ? (
    <img src={src} alt={alt} className={`adc-img${className ? ` ${className}` : ""}`} loading="lazy" decoding="async" />
  ) : (
    <span className={`adc-img empty${className ? ` ${className}` : ""}`} aria-hidden="true"><Camera size={30} /></span>
  );
}

/** The price this shopper pays: the store price, their account price with the store price crossed out, or per lb. */
export function PPrice({ item, big = false }: { item: PItem; big?: boolean }) {
  const { t, who, base } = usePartner();
  const cls = `adc-price${big ? " big" : ""}`;
  if (item.basis === "lb") {
    if (item.my_price !== null) {
      return (
        <span className={cls}>
          <b className="now ptn-now">{t.perLb(usd(item.my_price))}</b>
          <span className="off ptn-off">{t.yourPrice}</span>
        </span>
      );
    }
    return who.kind === "customer" ? (
      <span className={`${cls} quote`}>{t.perCustomer}</span>
    ) : (
      <Link href={`${base}/signin`} className={`${cls} quote`}>{t.perCustomerOut}</Link>
    );
  }
  const list = item.price;
  const mine = item.my_price ?? list;
  if (mine === null) return <span className={`${cls} quote`}>{t.quote}</span>;
  if (list === null || mine < list) {
    return (
      <span className={cls}>
        <b className="now ptn-now">{usd(mine)}</b>
        {list !== null ? <s>{usd(list)}</s> : null}
        <span className="off ptn-off">{t.yourPrice}</span>
      </span>
    );
  }
  return <span className={cls}><b>{usd(list)}</b>{item.msrp ? <span className="off ptn-msrp">{t.msrp}</span> : null}</span>;
}

function useDone(ms: number): [boolean, () => void] {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const x = setTimeout(() => setDone(false), ms);
    return () => clearTimeout(x);
  }, [done, ms]);
  return [done, () => setDone(true)];
}

/** A grid of product cards: big photo, part number, name, price, Add to cart. */
export function PGrid({ items }: { items: PItem[] }) {
  const { base, lang } = usePartner();
  return (
    <div className="adc-grid">
      {items.map((i) => {
        const href = `${base}/p/${encodeURIComponent(i.sku)}`;
        return (
          <div key={i.id} className="adc-card">
            <Link href={href} className="adc-card-ph" aria-label={i.name}><PImg src={i.image} alt={i.name} /></Link>
            <div className="adc-card-b">
              <span className="adc-sku">{i.sku}{i.category ? ` · ${catName(i.category, lang).toUpperCase()}` : ""}</span>
              <Link href={href} className="adc-card-n">{i.name}</Link>
              <PPrice item={i} />
              <PAdd item={i} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PAdd({ item }: { item: PItem }) {
  const { add, t } = usePartner();
  const [done, mark] = useDone(1500);
  return (
    <button type="button" className={`adc-add${done ? " done" : ""}`} onClick={() => (add({ id: item.id, sku: item.sku, name: item.name, image: item.image }, 1), mark())}>
      {done ? <><Check size={17} strokeWidth={3} /> {t.added}</> : isQuote(item) ? t.addToQuote : t.addToCart}
    </button>
  );
}

export function PBuy({ item }: { item: PItem }) {
  const { add, t } = usePartner();
  const [qty, setQty] = useState(1);
  const [done, mark] = useDone(1800);
  return (
    <div className="adc-buy">
      <div className="adc-qty" role="group" aria-label={t.qty}>
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t.less}><Minus size={18} /></button>
        <input inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(9999, Number(e.target.value.replace(/\D/g, "")) || 1)))} aria-label={t.qty} />
        <button type="button" onClick={() => setQty((q) => Math.min(9999, q + 1))} aria-label={t.more}><Plus size={18} /></button>
      </div>
      <button type="button" className={`adc-cta${done ? " done" : ""}`} onClick={() => (add({ id: item.id, sku: item.sku, name: item.name, image: item.image }, qty), mark())}>
        {done ? <><Check size={19} strokeWidth={3} /> {t.addedToCart}</> : isQuote(item) ? t.addToQuote : t.addToCart}
      </button>
    </div>
  );
}

/** Account and cart buttons in the header. */
export function PHeadButtons() {
  const { base, who, t, count, flash, ready } = usePartner();
  const acct = who.kind === "owner" || who.kind === "viewer" ? `${base}/desk` : who.kind === "customer" ? `${base}/account` : `${base}/signin`;
  const label = who.kind === "customer" || who.kind === "owner" || who.kind === "viewer" ? who.first ?? t.account : t.signIn;
  return (
    <>
      <Link href={acct} className="ptn-acct" aria-label={label}>
        <UserRound size={19} aria-hidden="true" />
        <span>{label}</span>
      </Link>
      <span className="adc-cartwrap">
        <Link href={`${base}/cart`} className="adc-cartbtn" aria-label={`${t.cart}, ${t.items(count)}`}>
          <ShoppingCart size={20} aria-hidden="true" />
          {ready && count ? <span className="adc-badge">{count > 99 ? "99+" : count}</span> : null}
        </Link>
        {flash ? (
          <span className="adc-flash" role="status">
            <Check size={14} strokeWidth={3} aria-hidden="true" /> {t.added}: {flash.length > 40 ? `${flash.slice(0, 40)}...` : flash}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** "Español" / "English": switches and comes back to the same page. */
export function PLangSwitch() {
  const { t, lang, base } = usePartner();
  const other = lang === "es" ? "en" : "es";
  const go = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    window.location.href = `${base}/lang?l=${other}&next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
  };
  return (
    <a href={`${base}/lang?l=${other}`} onClick={go} className="adc-lang" aria-label={t.langOtherLabel} title={t.langOtherLabel} hrefLang={other}>
      <span aria-hidden="true">{other.toUpperCase()}</span> {t.langOther}
    </a>
  );
}

/** The exploded gun drawing: a click puts the part in this store's cart. */
export function PDiagram({ slug, items }: { slug: string; items: PItem[] }) {
  const { add, lang } = usePartner();
  const d = diagramBySlug(slug);
  if (!d) return null;
  const bySku = new Map(items.map((i) => [i.sku.toLowerCase(), i]));
  const info: Record<string, PartInfo> = {};
  for (const p of d.parts) {
    const x = bySku.get(p.sku.toLowerCase());
    if (x) info[p.sku] = { id: x.id, price: linePrice(x), sale: null, quote: isQuote(x) };
  }
  return (
    <PartsDiagram
      diagram={d}
      info={info}
      canAddMissing
      lang={lang}
      onAdd={(p, i) => {
        const x = bySku.get(p.sku.toLowerCase());
        add({ id: i?.id ?? null, sku: p.sku, name: p.name, image: x?.image ?? null }, 1);
      }}
    />
  );
}
