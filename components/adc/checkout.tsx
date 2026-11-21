"use client";

import { seasonOf } from "@/lib/adc-season";
import { SeasonChip } from "@/components/adc/season";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BadgeCheck, CircleAlert, Cog, Gift, Info, LoaderCircle, Minus, Plus, ShoppingCart, Trash2, Truck, UserRound } from "lucide-react";
import { diagramThumb } from "@/lib/diagram-thumbs";
import { useAdcCart } from "@/components/adc/cart";
import { AdcSmsCheck } from "@/components/adc/sms";
import { usPhone } from "@/lib/sms-text";
import { adcShipEstimate, placeAdcOrder, type ShipQuote } from "@/app/adc/actions";
import { useAdc } from "@/components/adc/lang";
import { errText } from "@/lib/adc-i18n";

export type CatInfo = {
  sku: string;
  name: string;
  unit: string | null;
  list_price: number | null;
  sale_price: number | null;
  quote: boolean;
  image: string | null;
  foam?: boolean;
  ship: "parcel" | "freight" | "pickup" | "truckload";
  truck_qty: number | null;
  is_set: boolean;
};
/** The signed-in shopper (prefills checkout; their AM-BUCKS can go on the order). */
export type AdcMe = {
  email: string;
  name: string;
  company: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  bucks: number;
  promo: boolean;
} | null;
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The cart and checkout on one page. No payment: the order goes to AMBIT, who confirm price, shipping and payment. */
export function AdcCheckout({ cat, branches, foamNote, me, saleName = null }: { cat: Record<string, CatInfo>; branches: { id: string; name: string }[]; foamNote: string | null; me: AdcMe; saleName?: string | null }) {
  const { lines, setQty, clear, ready } = useAdcCart();
  const { t, lang } = useAdc();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"ship" | "pickup" | "truckload">("ship");
  // Who's ordering and where it goes (for the customer match, the billing and the shipping estimate).
  const [kind, setKind] = useState<"account" | "new" | null>(null);
  const [billSame, setBillSame] = useState(true);
  const [site, setSite] = useState<"business" | "home">("business");
  const [unload, setUnload] = useState<"dock" | "forklift" | "liftgate">("dock");
  const [zip, setZip] = useState(me?.zip ?? "");
  const [quote, setQuote] = useState<ShipQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const rows = lines.map((l) => {
    const c = l.id ? cat[l.id] : undefined;
    const price = c ? (c.quote ? null : c.sale_price ?? c.list_price) : null;
    return { ...l, c, price, gone: Boolean(l.id && !c) };
  });
  const live = rows.filter((r) => !r.gone);
  const subtotal = live.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0);
  const saved = live.reduce((s, r) => s + (r.c && r.c.sale_price !== null && r.c.list_price !== null && !r.c.quote ? Math.max(0, r.c.list_price - r.c.sale_price) * r.qty : 0), 0);
  const toConfirm = live.some((r) => r.price === null);

  // How it gets there: pick up only items, fiberglass (pick up or a full truck), freight items.
  const pickupOnly = live.filter((r) => r.c?.ship === "pickup");
  const truck = live.filter((r) => r.c?.ship === "truckload");
  const freight = live.filter((r) => r.c?.ship === "freight");
  const fill = truck.reduce((s, r) => s + (r.c?.truck_qty ? r.qty / r.c.truck_qty : 0), 0);
  const fillKnown = truck.every((r) => r.c?.truck_qty);
  const pct = fill > 0 && fill < 0.01 ? "<1" : Math.round(fill * 100);
  const blocked =
    delivery !== "pickup" && pickupOnly.length
      ? t.pickupOnly(pickupOnly.map((r) => r.sku).join(", "))
      : delivery === "ship" && truck.length
        ? t.truckOnly(truck.map((r) => r.sku).join(", "))
        : delivery === "truckload" && !truck.length
          ? t.shipTruck
          : delivery === "truckload" && fillKnown && fill < 0.95
            ? `${t.truckFill(pct)} ${t.truckNeed}`
            : null;

  // The shipping estimate: asked again (after a short pause) when the ZIP, the cart or the delivery choices change.
  const cartKey = live.map((r) => `${r.id ?? r.sku}:${r.qty}`).join(",");
  const zip5 = zip.replace(/\D/g, "").slice(0, 5);
  useEffect(() => {
    if (!ready || !cartKey || delivery === "pickup" || zip5.length < 5) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    let stop = false;
    setQuoting(true);
    const h = setTimeout(async () => {
      const items = cartKey.split(",").map((x) => {
        const [k, q] = x.split(":");
        const r = live.find((y) => (y.id ?? y.sku) === k);
        return { product_id: r?.id ?? null, sku: r?.sku ?? k, qty: Number(q) };
      });
      const res = await adcShipEstimate({ items, delivery, zip: zip5, site, unload }).catch(() => ({ ok: false }) as ShipQuote);
      if (!stop) {
        setQuote(res);
        setQuoting(false);
      }
    }, 600);
    return () => {
      stop = true;
      clearTimeout(h);
    };
    // live is derived from the cart; cartKey stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cartKey, delivery, zip5, site, unload]);

  if (!ready) return <div className="adc-empty"><LoaderCircle className="spin" size={26} /></div>;
  if (!lines.length) {
    return (
      <div className="adc-empty">
        <ShoppingCart size={30} aria-hidden="true" />
        <b>{t.cartEmpty}</b>
        <Link href="/adc" className="adc-cta">{t.shopAll}</Link>
      </div>
    );
  }

  const submit = (f: FormData) => {
    setError(null);
    if (blocked) {
      setError(blocked);
      return;
    }
    if (!kind) {
      setError(t.custQ);
      return;
    }
    const s = (k: string) => String(f.get(k) ?? "");
    if (f.get("sms") === "on" && !usPhone(s("phone"))) {
      setError(t.smsPhone);
      return;
    }
    start(async () => {
      const res = await placeAdcOrder({
        name: s("name"),
        company: s("company"),
        email: s("email"),
        phone: s("phone"),
        delivery,
        pickup_branch: s("pickup_branch"),
        address: { street: s("street"), street2: s("street2"), city: s("city"), state: s("state"), zip: s("zip") },
        notes: s("notes"),
        website: s("website"),
        lang,
        promo_opt_in: f.get("promo") === "on",
        sms_opt_in: f.get("sms") === "on",
        use_bucks: f.get("bucks") === "on",
        customer: {
          kind,
          check: "",
          bill_same: delivery !== "pickup" && billSame,
          bill: { street: s("bill_street"), city: s("bill_city"), state: s("bill_state"), zip: s("bill_zip") },
          tax_exempt: false,
          hours: s("hours"),
          site,
          unload,
        },
        items: live.map((r) => (r.id ? { product_id: r.id, qty: r.qty } : { sku: r.sku, name: r.name, qty: r.qty })),
      });
      if (!res.ok) {
        setError(errText(res.error, lang));
        return;
      }
      clear();
      router.push(`/adc/thanks?n=${encodeURIComponent(res.order_no)}`);
    });
  };

  return (
    <div className="adc-co">
      <section className="adc-co-cart" aria-label={t.yourCart}>
        {rows.map((r) => (
          <div key={r.key} className={`adc-line${r.gone ? " gone" : ""}`}>
            {r.c?.image || r.image || diagramThumb(r.sku) ? (
              <img src={(r.c?.image || r.image || diagramThumb(r.sku))!} alt="" className="adc-line-ph" />
            ) : (
              <span className="adc-line-ph empty" aria-hidden="true"><Cog size={28} strokeWidth={1.6} /></span>
            )}
            <span className="adc-line-b">
              <b>{r.c?.name ?? r.name}</b>
              <span>{t.partLine(r.sku)}{r.gone ? ` · ${t.gone}` : r.price === null ? ` · ${t.toConfirm}` : ` · ${t.each(usd(r.price))}`}</span>
              {r.c?.is_set ? <span className="adc-set">{t.setBadge} · {t.sets(r.qty)}</span> : null}
              {seasonOf({ sku: r.sku, name: r.c?.name ?? r.name, category_id: r.c ? (r.c.foam ? "ambit-foam" : "other") : null }) ? (
                <span className="adc-line-season"><SeasonChip season={seasonOf({ sku: r.sku, name: r.c?.name ?? r.name, category_id: r.c ? (r.c.foam ? "ambit-foam" : "other") : null })} lang={lang} /></span>
              ) : null}
              {r.c && r.c.sale_price !== null && !r.c.quote ? <span className="adc-line-sale">{t.salePrice}</span> : null}
              {r.c?.quote && r.c.foam && foamNote ? <span className="adc-line-sale">{foamNote}</span> : null}
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
          {saved > 0 ? <span className="adc-saved">{t.youSave(usd(saved))}</span> : null}
          <span>{toConfirm ? t.subtotalPriced : t.subtotal}</span>
          <b>{usd(subtotal)}</b>
        </div>
        <div className="adc-shipline">
          <span><Truck size={16} aria-hidden="true" /> {delivery === "pickup" ? t.shipping : t.shipEst}</span>
          <b>
            {delivery === "pickup"
              ? t.shipPickupFree
              : zip5.length < 5
                ? <span className="adc-muted">{t.shipEstWait}</span>
                : quoting
                  ? <span className="adc-muted"><LoaderCircle size={14} className="spin" /> {t.shipEstCalc}</span>
                  : quote?.ok && quote.estimate !== null
                    ? <>{usd(quote.estimate)}{quote.partial ? <span className="adc-muted small"> {t.shipEstPlus}</span> : null}</>
                    : t.shipQuoted}
          </b>
        </div>
        {delivery !== "pickup" && quote?.ok && quote.estimate !== null ? (
          <div className="adc-tot adc-tot-est">
            <span>{t.subtotal} + {t.shipEst.toLowerCase()}</span>
            <b>{usd(subtotal + quote.estimate)}</b>
          </div>
        ) : null}
        <p className="adc-muted small">{delivery !== "pickup" && quote?.ok ? `${t.shipEstNote} ` : ""}{t.taxNote}{toConfirm ? t.confirmNote : ""} {t.shipDisclaimer}</p>
        <p className="adc-note-b small"><Info size={15} aria-hidden="true" /> {t.contactNote}</p>
      </section>

      <form action={submit} className="adc-co-form" aria-label={t.checkout}>
        <h2 className="adc-h2">{t.checkout}</h2>
        <p className="adc-muted small" style={{ margin: 0 }}>{t.requestNote}</p>
        {me ? (
          <div className="adc-me"><UserRound size={18} aria-hidden="true" /><span>{t.signedInAs(me.email)}</span></div>
        ) : (
          <Link href="/adc/account?next=/adc/cart" className="adc-me link"><Gift size={18} aria-hidden="true" /><span>{t.earnBucks} <b>{t.createAccount}</b> · {t.signIn}</span></Link>
        )}
        <div className="adc-f2">
          <label className="adc-f"><span>{t.name}</span><input name="name" required autoComplete="name" defaultValue={me?.name ?? ""} /></label>
          <label className="adc-f"><span>{t.bizName}</span><input name="company" required minLength={2} autoComplete="organization" placeholder={t.bizNamePh} defaultValue={me?.company ?? ""} /></label>
          <label className="adc-f"><span>{t.email}</span><input name="email" type="email" required autoComplete="email" defaultValue={me?.email ?? ""} /></label>
          <label className="adc-f"><span>{t.phone}</span><input name="phone" type="tel" required autoComplete="tel" defaultValue={me?.phone ?? ""} /></label>
        </div>
        <AdcSmsCheck />
        <div className="adc-cust">
          <span className="adc-q">{t.custQ}</span>
          <div className="adc-seg" role="radiogroup" aria-label={t.custQ}>
            <button type="button" role="radio" aria-checked={kind === "account"} className={kind === "account" ? "on" : undefined} onClick={() => setKind("account")}>{t.custYes}</button>
            <button type="button" role="radio" aria-checked={kind === "new"} className={kind === "new" ? "on" : undefined} onClick={() => setKind("new")}>{t.custNo}</button>
          </div>
          {kind === "account" ? (
            <>
              <p className="adc-muted small" style={{ margin: 0 }}>{t.acctCheckHint}</p>
              {saleName ? <p className="adc-foam-note small" style={{ margin: 0 }}><BadgeCheck size={16} aria-hidden="true" /><span>{t.acctBfNote(saleName)}</span></p> : null}
            </>
          ) : kind === "new" ? (
            <p className="adc-note-b small" style={{ margin: 0 }}><Info size={15} aria-hidden="true" /> {t.newCustNote}</p>
          ) : null}
        </div>
        <div className="adc-seg" role="radiogroup" aria-label={t.delivery}>
          <button type="button" role="radio" aria-checked={delivery === "ship"} className={delivery === "ship" ? "on" : undefined} onClick={() => setDelivery("ship")}>{t.shipIt}</button>
          <button type="button" role="radio" aria-checked={delivery === "pickup"} className={delivery === "pickup" ? "on" : undefined} onClick={() => setDelivery("pickup")}>{t.pickUp}</button>
          {truck.length ? (
            <button type="button" role="radio" aria-checked={delivery === "truckload"} className={delivery === "truckload" ? "on" : undefined} onClick={() => setDelivery("truckload")}>{t.deliveryTruck}</button>
          ) : null}
        </div>
        {truck.length ? (
          <div className="adc-truck">
            <div className="adc-truck-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }} /></div>
            <span>{fillKnown ? (fill >= 0.95 ? t.truckFull : t.truckFill(pct)) : t.truckUnknown}</span>
          </div>
        ) : null}
        {freight.length && delivery !== "pickup" ? <p className="adc-note-b small"><Truck size={15} aria-hidden="true" /> {t.freightNote}</p> : null}
        {blocked ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {blocked}</div> : null}
        {delivery !== "pickup" ? (
          <div className="adc-f2">
            <label className="adc-f wide"><span>{t.street}</span><input name="street" required autoComplete="address-line1" defaultValue={me?.street ?? ""} /></label>
            <label className="adc-f wide"><span>{t.street2}</span><input name="street2" autoComplete="address-line2" /></label>
            <label className="adc-f"><span>{t.city}</span><input name="city" required autoComplete="address-level2" defaultValue={me?.city ?? ""} /></label>
            <span className="adc-f2 tight">
              <label className="adc-f"><span>{t.state}</span><input name="state" required maxLength={2} autoComplete="address-level1" placeholder="OK" defaultValue={me?.state ?? ""} /></label>
              <label className="adc-f"><span>{t.zip}</span><input name="zip" required inputMode="numeric" autoComplete="postal-code" defaultValue={me?.zip ?? ""} onChange={(e) => setZip(e.target.value)} /></label>
            </span>
            <div className="adc-f wide">
              <span>{t.siteQ}</span>
              <div className="adc-seg sm" role="radiogroup" aria-label={t.siteQ}>
                <button type="button" role="radio" aria-checked={site === "business"} className={site === "business" ? "on" : undefined} onClick={() => setSite("business")}>{t.siteBiz}</button>
                <button type="button" role="radio" aria-checked={site === "home"} className={site === "home" ? "on" : undefined} onClick={() => setSite("home")}>{t.siteHome}</button>
              </div>
            </div>
            <label className="adc-f wide"><span>{t.hoursQ}</span><input name="hours" maxLength={120} placeholder={t.hoursPh} autoComplete="off" /></label>
            {freight.length || truck.length ? (
              <div className="adc-f wide">
                <span>{t.unloadQ}</span>
                <div className="adc-seg sm" role="radiogroup" aria-label={t.unloadQ}>
                  <button type="button" role="radio" aria-checked={unload === "dock"} className={unload === "dock" ? "on" : undefined} onClick={() => setUnload("dock")}>{t.unloadDock}</button>
                  <button type="button" role="radio" aria-checked={unload === "forklift"} className={unload === "forklift" ? "on" : undefined} onClick={() => setUnload("forklift")}>{t.unloadFork}</button>
                  <button type="button" role="radio" aria-checked={unload === "liftgate"} className={unload === "liftgate" ? "on" : undefined} onClick={() => setUnload("liftgate")}>{t.unloadLift}</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <label className="adc-f"><span>{t.pickupAt}</span>
            <select name="pickup_branch" required defaultValue="">
              <option value="" disabled>{t.pickLoc}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        {kind === "new" ? (
          <div className="adc-bill">
            <span className="adc-q">{t.billTitle}</span>
            {delivery !== "pickup" ? (
              <label className="adc-check"><input type="checkbox" checked={billSame} onChange={(e) => setBillSame(e.target.checked)} /> <span>{t.billSame}</span></label>
            ) : null}
            {delivery === "pickup" || !billSame ? (
              <div className="adc-f2">
                <label className="adc-f wide"><span>{t.street}</span><input name="bill_street" required autoComplete="billing address-line1" /></label>
                <label className="adc-f"><span>{t.city}</span><input name="bill_city" required autoComplete="billing address-level2" /></label>
                <span className="adc-f2 tight">
                  <label className="adc-f"><span>{t.state}</span><input name="bill_state" required maxLength={2} autoComplete="billing address-level1" placeholder="OK" /></label>
                  <label className="adc-f"><span>{t.zip}</span><input name="bill_zip" required inputMode="numeric" autoComplete="billing postal-code" /></label>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        <label className="adc-f"><span>{t.notes}</span><textarea name="notes" rows={3} placeholder={t.notesPh} /></label>
        {me && me.bucks > 0 ? (
          <label className="adc-check"><input type="checkbox" name="bucks" defaultChecked /> <span>{t.useBucks(usd(me.bucks))}</span></label>
        ) : null}
        <label className="adc-check"><input type="checkbox" name="promo" defaultChecked={me ? me.promo : true} /> <span>{t.promoOpt}</span></label>
        <input name="website" tabIndex={-1} autoComplete="off" className="adc-hp" aria-hidden="true" />
        {error ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {error}</div> : null}
        <button type="submit" className="adc-cta block" disabled={pending || !live.length || Boolean(blocked)}>
          {pending ? <><LoaderCircle size={18} className="spin" /> {t.sending}</> : t.placeOrder}
        </button>
        <p className="adc-muted small center" style={{ margin: 0 }}>{t.contactNote}</p>
      </form>
    </div>
  );
}
