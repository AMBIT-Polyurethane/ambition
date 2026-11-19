"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Camera, Check, Minus, Plus, Search, ShoppingCart, Store, Truck, UserRound } from "lucide-react";
import { PartsDiagram, type PartInfo } from "@/components/parts-diagram";
import { diagramBySlug } from "@/lib/diagrams";
import { usePartner, usd, type PItem } from "@/components/partner/store";

/** The product photo without the AMBIT / ADC badge in its corner (the partner's store shows plain photos). */
export function PImg({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    <span className="ptn-ph"><img src={src} alt={alt} className="adc-img" loading="lazy" decoding="async" /></span>
  ) : (
    <span className="adc-img empty" aria-hidden="true"><Camera size={30} /></span>
  );
}

/** Header, category bar and footer in the partner's colors and logo (both can be changed on the partner's desk). */
export function PartnerFrame({ cats, children }: { cats: { id: string; name: string }[]; children: React.ReactNode }) {
  const { partner, brand, cart, me, flash, ready } = usePartner();
  const base = `/store/${partner.slug}`;
  const count = cart.reduce((n, l) => n + l.qty, 0);
  return (
    <div className="adc ptn" style={{ "--p-color": brand.color, "--p-color2": brand.color2 } as React.CSSProperties}>
      <div className="ptn-ribbon">
        <span><Store size={14} aria-hidden="true" /> Preview store built with AMBIT. Orders here are samples and go nowhere.</span>
        <Link href={`${base}/desk`}>Open the {partner.short} desk</Link>
      </div>
      <header className="adc-head ptn-head">
        <div className="adc-wrap adc-bar">
          <Link href={base} className="adc-logo ptn-logo" aria-label={`${brand.name} home`}>
            {brand.logo ? <img src={brand.logo} alt={brand.name} /> : <b>{brand.name}</b>}
          </Link>
          <form action={base} className="adc-search" role="search">
            <Search size={18} aria-hidden="true" />
            <input type="search" name="q" placeholder="Search parts and guns by name or part number" aria-label="Search the store" />
          </form>
          <Link href={`${base}/account`} className="ptn-acct" aria-label={me ? `Your account, ${me.company}` : "Sign in"}>
            <UserRound size={19} aria-hidden="true" />
            <span>{ready && me ? me.contact.split(" ")[0] : "Sign in"}</span>
          </Link>
          <span className="adc-cartwrap">
            <Link href={`${base}/cart`} className="adc-cartbtn" aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}>
              <ShoppingCart size={20} aria-hidden="true" />
              {ready && count ? <span className="adc-badge">{count > 99 ? "99+" : count}</span> : null}
            </Link>
            {flash ? <span className="adc-flash" role="status"><Check size={14} strokeWidth={3} aria-hidden="true" /> Added: {flash.length > 40 ? `${flash.slice(0, 40)}...` : flash}</span> : null}
          </span>
        </div>
        {cats.length ? (
          <nav className="adc-cats" aria-label="Shop">
            <div className="adc-wrap">{cats.map((c) => <Link key={c.id} href={`${base}?c=${encodeURIComponent(c.id)}`}>{c.name}</Link>)}</div>
          </nav>
        ) : null}
      </header>
      <main className="adc-main">{children}</main>
      <footer className="adc-foot ptn-foot">
        <div className="adc-wrap adc-foot-in">
          {brand.logo ? <img src={brand.logo} alt="" className="ptn-foot-logo" /> : <b>{brand.name}</b>}
          <span><Truck size={16} aria-hidden="true" /> {brand.tagline}</span>
          <span>Questions? <a href={`mailto:${partner.email}`}>{partner.email}</a> · {partner.phone}</span>
          <span className="adc-fine">Store powered by AMBIT Polyurethane.</span>
        </div>
      </footer>
    </div>
  );
}

/** The price this shopper pays: list price, or their account price with the list price crossed out. */
export function PPrice({ item, big = false }: { item: PItem; big?: boolean }) {
  const { storePrice, priceFor, me, ready } = usePartner();
  const list = storePrice(item);
  const mine = ready ? priceFor(item) : list;
  if (list === null || mine === null) return <span className={`adc-price quote${big ? " big" : ""}`}>{me ? "Your price: we'll confirm it" : "Request a quote"}</span>;
  if (me && mine < list) {
    return (
      <span className={`adc-price${big ? " big" : ""}`}>
        <b className="now ptn-now">{usd(mine)}</b>
        <s>{usd(list)}</s>
        <span className="off ptn-off">Your price</span>
      </span>
    );
  }
  return <span className={`adc-price${big ? " big" : ""}`}><b>{usd(list)}</b></span>;
}

function useDone(ms: number): [boolean, () => void] {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), ms);
    return () => clearTimeout(t);
  }, [done, ms]);
  return [done, () => setDone(true)];
}

export function PGrid({ items }: { items: PItem[] }) {
  const { partner, add } = usePartner();
  return (
    <div className="adc-grid">
      {items.map((i) => (
        <PCard key={i.id} i={i} href={`/store/${partner.slug}/p/${encodeURIComponent(i.sku)}`} onAdd={() => add(i)} />
      ))}
    </div>
  );
}

function PCard({ i, href, onAdd }: { i: PItem; href: string; onAdd: () => void }) {
  const [done, mark] = useDone(1500);
  return (
    <div className="adc-card">
      <Link href={href} className="adc-card-ph" aria-label={i.name}><PImg src={i.image} alt={i.name} /></Link>
      <div className="adc-card-b">
        <span className="adc-sku">{i.sku}{i.category ? ` · ${i.category.toUpperCase()}` : ""}</span>
        <Link href={href} className="adc-card-n">{i.name}</Link>
        <PPrice item={i} />
        <button type="button" className={`adc-add${done ? " done" : ""}`} onClick={() => (onAdd(), mark())}>
          {done ? <><Check size={17} strokeWidth={3} /> Added</> : i.quote ? "Add to quote request" : "Add to cart"}
        </button>
      </div>
    </div>
  );
}

export function PBuy({ item }: { item: PItem }) {
  const { add } = usePartner();
  const [qty, setQty] = useState(1);
  const [done, mark] = useDone(1800);
  return (
    <div className="adc-buy">
      <div className="adc-qty" role="group" aria-label="Quantity">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less"><Minus size={18} /></button>
        <input inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(9999, Number(e.target.value.replace(/\D/g, "")) || 1)))} aria-label="Quantity" />
        <button type="button" onClick={() => setQty((q) => Math.min(9999, q + 1))} aria-label="More"><Plus size={18} /></button>
      </div>
      <button type="button" className={`adc-cta${done ? " done" : ""}`} onClick={() => (add(item, qty), mark())}>
        {done ? <><Check size={19} strokeWidth={3} /> Added to cart</> : item.quote ? "Add to quote request" : "Add to cart"}
      </button>
    </div>
  );
}

/** The exploded gun drawing: a part's own picture lights up, a click puts it in this store's cart. */
export function PDiagram({ slug }: { slug: string }) {
  const { items, add, priceFor } = usePartner();
  const d = diagramBySlug(slug);
  if (!d) return null;
  const bySku = new Map(items.map((i) => [i.sku.toLowerCase(), i]));
  const info: Record<string, PartInfo> = {};
  for (const p of d.parts) {
    const x = bySku.get(p.sku.toLowerCase());
    if (x) info[p.sku] = { id: x.id, price: priceFor(x), sale: null, quote: x.quote };
  }
  return (
    <PartsDiagram
      diagram={d}
      info={info}
      canAddMissing
      onAdd={(p, i) => {
        const x = bySku.get(p.sku.toLowerCase());
        add({ id: i?.id ?? null, sku: p.sku, name: p.name, image: x?.image ?? null }, 1);
      }}
    />
  );
}
