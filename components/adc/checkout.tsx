"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CircleAlert, LoaderCircle, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useAdcCart } from "@/components/adc/cart";
import { placeAdcOrder } from "@/app/adc/actions";

export type CatInfo = { sku: string; name: string; unit: string | null; list_price: number | null; sale_price: number | null; quote: boolean; image: string | null };
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The cart and a guest checkout on one page. No payment: the order goes to AMBIT, who confirm price, shipping and payment. */
export function AdcCheckout({ cat, branches, foamNote }: { cat: Record<string, CatInfo>; branches: { id: string; name: string }[]; foamNote: string | null }) {
  const { lines, setQty, clear, ready } = useAdcCart();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"ship" | "pickup">("ship");

  const rows = lines.map((l) => {
    const c = l.id ? cat[l.id] : undefined;
    const price = c ? (c.quote ? null : c.sale_price ?? c.list_price) : null;
    return { ...l, c, price, gone: Boolean(l.id && !c) };
  });
  const live = rows.filter((r) => !r.gone);
  const subtotal = live.reduce((s, r) => s + (r.price ?? 0) * r.qty, 0);
  const saved = live.reduce((s, r) => s + (r.c && r.c.sale_price !== null && r.c.list_price !== null && !r.c.quote ? (r.c.list_price - r.c.sale_price) * r.qty : 0), 0);
  const toConfirm = live.some((r) => r.price === null);

  if (!ready) return <div className="adc-empty"><LoaderCircle className="spin" size={26} /></div>;
  if (!lines.length) {
    return (
      <div className="adc-empty">
        <ShoppingCart size={30} aria-hidden="true" />
        <b>Your cart is empty.</b>
        <Link href="/adc" className="adc-cta">Shop guns, parts &amp; supplies</Link>
      </div>
    );
  }

  const submit = (f: FormData) => {
    setError(null);
    const s = (k: string) => String(f.get(k) ?? "");
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
        items: live.map((r) => (r.id ? { product_id: r.id, qty: r.qty } : { sku: r.sku, name: r.name, qty: r.qty })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      clear();
      router.push(`/adc/thanks?n=${encodeURIComponent(res.order_no)}`);
    });
  };

  return (
    <div className="adc-co">
      <section className="adc-co-cart" aria-label="Your cart">
        {rows.map((r) => (
          <div key={r.key} className={`adc-line${r.gone ? " gone" : ""}`}>
            {r.image || r.c?.image ? <img src={(r.c?.image ?? r.image)!} alt="" className="adc-line-ph" /> : <span className="adc-line-ph empty" aria-hidden="true" />}
            <span className="adc-line-b">
              <b>{r.c?.name ?? r.name}</b>
              <span>Part {r.sku}{r.gone ? " · no longer in the store" : r.price === null ? " · price to confirm" : ` · ${usd(r.price)} each`}</span>
              {r.c && r.c.sale_price !== null && !r.c.quote ? <span className="adc-line-sale">Sale price</span> : null}
              {r.c?.quote && foamNote ? <span className="adc-line-sale">{foamNote}</span> : null}
            </span>
            <span className="adc-qty sm" role="group" aria-label={`Quantity of ${r.name}`}>
              <button type="button" onClick={() => setQty(r.key, r.qty - 1)} aria-label="Less"><Minus size={16} /></button>
              <input inputMode="numeric" value={r.qty} onChange={(e) => setQty(r.key, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))} aria-label="Quantity" />
              <button type="button" onClick={() => setQty(r.key, r.qty + 1)} aria-label="More"><Plus size={16} /></button>
            </span>
            <b className="adc-line-t">{r.price === null ? "-" : usd(r.price * r.qty)}</b>
            <button type="button" className="adc-x" onClick={() => setQty(r.key, 0)} aria-label={`Remove ${r.name}`}><Trash2 size={17} /></button>
          </div>
        ))}
        <div className="adc-tot">
          {saved > 0 ? <span className="adc-saved">You save {usd(saved)}</span> : null}
          <span>Subtotal{toConfirm ? " (priced items)" : ""}</span>
          <b>{usd(subtotal)}</b>
        </div>
        <p className="adc-muted small">Shipping and tax are added when we confirm your order.{toConfirm ? " Items marked “price to confirm” are priced by AMBIT before anything ships." : ""}</p>
      </section>

      <form action={submit} className="adc-co-form" aria-label="Checkout">
        <h2 className="adc-h2">Checkout</h2>
        <p className="adc-muted small" style={{ margin: 0 }}>No account and no card needed. We&apos;ll call or email you to confirm the total, shipping and payment before anything ships.</p>
        <div className="adc-f2">
          <label className="adc-f"><span>Your name</span><input name="name" required autoComplete="name" /></label>
          <label className="adc-f"><span>Company (optional)</span><input name="company" autoComplete="organization" /></label>
          <label className="adc-f"><span>Email</span><input name="email" type="email" required autoComplete="email" /></label>
          <label className="adc-f"><span>Phone</span><input name="phone" type="tel" required autoComplete="tel" /></label>
        </div>
        <div className="adc-seg" role="radiogroup" aria-label="Delivery">
          <button type="button" role="radio" aria-checked={delivery === "ship"} className={delivery === "ship" ? "on" : undefined} onClick={() => setDelivery("ship")}>Ship it to me</button>
          <button type="button" role="radio" aria-checked={delivery === "pickup"} className={delivery === "pickup" ? "on" : undefined} onClick={() => setDelivery("pickup")}>I&apos;ll pick it up</button>
        </div>
        {delivery === "ship" ? (
          <div className="adc-f2">
            <label className="adc-f wide"><span>Street address</span><input name="street" required autoComplete="address-line1" /></label>
            <label className="adc-f wide"><span>Suite, unit (optional)</span><input name="street2" autoComplete="address-line2" /></label>
            <label className="adc-f"><span>City</span><input name="city" required autoComplete="address-level2" /></label>
            <span className="adc-f2 tight">
              <label className="adc-f"><span>State</span><input name="state" required maxLength={2} autoComplete="address-level1" placeholder="OK" /></label>
              <label className="adc-f"><span>ZIP</span><input name="zip" required inputMode="numeric" autoComplete="postal-code" /></label>
            </span>
          </div>
        ) : (
          <label className="adc-f"><span>Pick up at</span>
            <select name="pickup_branch" required defaultValue="">
              <option value="" disabled>Pick a location</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <label className="adc-f"><span>Notes (optional)</span><textarea name="notes" rows={3} placeholder="Job name, PO number, when you need it..." /></label>
        <input name="website" tabIndex={-1} autoComplete="off" className="adc-hp" aria-hidden="true" />
        {error ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {error}</div> : null}
        <button type="submit" className="adc-cta block" disabled={pending || !live.length}>
          {pending ? <><LoaderCircle size={18} className="spin" /> Sending your order...</> : "Place order"}
        </button>
      </form>
    </div>
  );
}
