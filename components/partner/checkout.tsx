"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, CircleAlert, LoaderCircle, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { placePartnerOrder } from "@/app/store/actions";
import { usePartner, usd } from "@/components/partner/ctx";
import { PImg, linePrice, type PItem } from "@/components/partner/ui";

export type PPrefill = { name: string; company: string; email: string; phone: string; street: string; city: string; state: string; zip: string } | null;

/** The cart and checkout on one page. No card: the store confirms the order and sends an invoice. */
export function PCheckout({ items, prefill }: { items: Record<string, PItem>; prefill: PPrefill }) {
  const { base, store, t, lang, who, lines, setQty, clear, ready } = usePartner();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"ship" | "pickup">("ship");

  const rows = lines.map((l) => {
    const c = l.id ? items[l.id] : undefined;
    const price = c ? linePrice(c) : null;
    return { ...l, c, price, gone: Boolean(l.id && !c) };
  });
  const live = rows.filter((r) => !r.gone);
  const subtotal = live.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0);
  const toConfirm = live.some((r) => r.price === null);

  if (!ready) return <div className="adc-empty"><LoaderCircle className="spin" size={26} /></div>;
  if (!lines.length) {
    return (
      <div className="adc-empty">
        <ShoppingCart size={30} aria-hidden="true" />
        <b>{t.cartEmpty}</b>
        <Link href={base} className="adc-cta">{t.shopAll}</Link>
      </div>
    );
  }

  const submit = (f: FormData) => {
    setError(null);
    const s = (k: string) => String(f.get(k) ?? "");
    start(async () => {
      const res = await placePartnerOrder(store.slug, {
        name: s("name"),
        company: s("company"),
        email: s("email"),
        phone: s("phone"),
        delivery,
        address: { street: s("street"), city: s("city"), state: s("state"), zip: s("zip") },
        po: s("po"),
        notes: s("notes"),
        website: s("website"),
        lang: lang === "es" ? "es" : "en",
        items: live.map((r) => (r.id ? { item_id: r.id, qty: r.qty } : { sku: r.sku, name: r.name, qty: r.qty })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      clear();
      router.push(`${base}/thanks?n=${encodeURIComponent(res.order_no)}`);
    });
  };

  const p = prefill;
  return (
    <div className="adc-co">
      <section className="adc-co-cart" aria-label={t.yourCart}>
        {rows.map((r) => (
          <div key={r.key} className={`adc-line${r.gone ? " gone" : ""}`}>
            <span className="adc-line-ph"><PImg src={r.c?.image ?? r.image ?? null} alt="" /></span>
            <span className="adc-line-b">
              <b>{r.c?.name ?? r.name}</b>
              <span>
                {t.partLine(r.sku)}
                {r.gone
                  ? ` · ${t.gone}`
                  : r.c?.basis === "lb"
                    ? ` · ${r.c.my_price !== null ? t.perLb(usd(r.c.my_price)) : t.toConfirm}`
                    : r.price === null
                      ? ` · ${t.toConfirm}`
                      : ` · ${t.each(usd(r.price))}`}
              </span>
            </span>
            <span className="adc-qty sm" role="group" aria-label={`${t.qty}: ${r.name}`}>
              <button type="button" onClick={() => setQty(r.key, r.qty - 1)} aria-label={t.less}><Minus size={16} /></button>
              <input inputMode="numeric" value={r.qty} onChange={(e) => setQty(r.key, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))} aria-label={t.qty} />
              <button type="button" onClick={() => setQty(r.key, r.qty + 1)} aria-label={t.more}><Plus size={16} /></button>
            </span>
            <b className="adc-line-t">{r.price === null ? "-" : usd(r.price * r.qty)}</b>
            <button type="button" className="adc-x" onClick={() => setQty(r.key, 0)} aria-label={t.remove(r.name)}><Trash2 size={17} /></button>
          </div>
        ))}
        <div className="adc-tot">
          <span>{toConfirm ? t.subtotalPriced : t.subtotal}</span>
          <b>{usd(subtotal)}</b>
        </div>
        <p className="adc-muted small">{t.taxNote}{toConfirm ? t.confirmNote : ""}</p>
      </section>

      <form action={submit} className="adc-co-form" aria-label={t.checkout}>
        <h2 className="adc-h2">{t.checkout}</h2>
        <p className="adc-muted small" style={{ margin: 0 }}>{t.noCard}</p>
        {who.kind === "customer" && who.company ? (
          <div className="ptn-who">
            <Building2 size={18} aria-hidden="true" />
            <span><b>{who.company}</b><span>{t.billedTo(who.company, who.terms)}</span></span>
          </div>
        ) : (
          <span className="ptn-guest-h">{t.guest} · <Link href={`${base}/signin?next=${encodeURIComponent(`${base}/cart`)}`}>{t.signIn}</Link></span>
        )}
        <div className="adc-f2">
          <label className="adc-f"><span>{t.name}</span><input name="name" required autoComplete="name" defaultValue={p?.name ?? ""} /></label>
          <label className="adc-f"><span>{t.company}</span><input name="company" autoComplete="organization" defaultValue={p?.company ?? ""} /></label>
          <label className="adc-f"><span>{t.email}</span><input name="email" type="email" required autoComplete="email" defaultValue={p?.email ?? ""} /></label>
          <label className="adc-f"><span>{t.phone}</span><input name="phone" type="tel" required={who.kind !== "customer"} autoComplete="tel" defaultValue={p?.phone ?? ""} /></label>
        </div>
        <div className="adc-seg" role="radiogroup" aria-label={t.delivery}>
          <button type="button" role="radio" aria-checked={delivery === "ship"} className={delivery === "ship" ? "on" : undefined} onClick={() => setDelivery("ship")}>{t.shipIt}</button>
          <button type="button" role="radio" aria-checked={delivery === "pickup"} className={delivery === "pickup" ? "on" : undefined} onClick={() => setDelivery("pickup")}>{t.pickUp}</button>
        </div>
        {delivery === "ship" ? (
          <div className="adc-f2">
            <label className="adc-f wide"><span>{t.street}</span><input name="street" required autoComplete="address-line1" defaultValue={p?.street ?? ""} /></label>
            <label className="adc-f"><span>{t.city}</span><input name="city" required autoComplete="address-level2" defaultValue={p?.city ?? ""} /></label>
            <span className="adc-f2 tight">
              <label className="adc-f"><span>{t.state}</span><input name="state" required maxLength={2} autoComplete="address-level1" defaultValue={p?.state ?? ""} placeholder="MO" /></label>
              <label className="adc-f"><span>{t.zip}</span><input name="zip" required inputMode="numeric" autoComplete="postal-code" defaultValue={p?.zip ?? ""} /></label>
            </span>
          </div>
        ) : null}
        <label className="adc-f"><span>{t.po}</span><input name="po" maxLength={60} /></label>
        <label className="adc-f"><span>{t.notes}</span><textarea name="notes" rows={3} placeholder={t.notesPh} /></label>
        <input name="website" tabIndex={-1} autoComplete="off" className="adc-hp" aria-hidden="true" />
        {error ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {error}</div> : null}
        <button type="submit" className="adc-cta block" disabled={pending || !live.length}>
          {pending ? <><LoaderCircle size={18} className="spin" /> {t.sending}</> : t.placeOrder}
        </button>
      </form>
    </div>
  );
}
