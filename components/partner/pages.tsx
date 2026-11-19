"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, Building2, CircleCheck, Layers, LogOut, Minus, Package, Plus, RotateCcw, Search, ShoppingCart, Trash2, Truck, UserRound } from "lucide-react";
import { DIAGRAMS, diagramFor } from "@/lib/diagrams";
import { keyOf, usePartner, usd, type PItem, type POrder } from "@/components/partner/store";
import { PBuy, PDiagram, PGrid, PImg, PPrice } from "@/components/partner/ui";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const cats = (items: PItem[]) => {
  const out: { id: string; name: string; n: number; image: string | null }[] = [];
  for (const i of items) {
    if (!i.category_id) continue;
    const c = out.find((x) => x.id === i.category_id);
    if (c) { c.n++; if (!c.image && i.image) c.image = i.image; }
    else out.push({ id: i.category_id, name: i.category ?? "Other", n: 1, image: i.image });
  }
  return out;
};

// ------------------------------------------------------------------ home, search, category

export function PHome({ q, c }: { q: string; c: string }) {
  const { partner, items, brand, me } = usePartner();
  const base = `/store/${partner.slug}`;
  const all = cats(items);
  const cat = all.find((x) => x.id === c) ?? null;
  if (q || cat) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((i) => (!cat || i.category_id === cat.id) && words.every((w) => `${i.sku} ${i.name} ${i.category ?? ""}`.toLowerCase().includes(w)));
    const title = q ? `Results for “${q}”` : cat!.name;
    return (
      <div className="adc-wrap adc-pad adc-stack-s">
        <nav className="adc-crumbs" aria-label="Breadcrumb"><Link href={base}>Home</Link><span aria-hidden="true">›</span><span>{title}</span></nav>
        <div className="adc-sec-h"><h1 className="adc-h1">{title}</h1><span className="adc-muted">{shown.length} {shown.length === 1 ? "item" : "items"}</span></div>
        <div className="adc-chips">
          <Link href={q ? `${base}?q=${encodeURIComponent(q)}` : base} className={!cat ? "on" : undefined}>All</Link>
          {all.map((x) => <Link key={x.id} href={`${base}?c=${encodeURIComponent(x.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={cat?.id === x.id ? "on" : undefined}>{x.name}</Link>)}
        </div>
        {shown.length ? <PGrid items={shown} /> : <div className="adc-empty"><Search size={28} aria-hidden="true" /><b>Nothing matches that.</b><span>Try a part number, or call {partner.phone}.</span></div>}
      </div>
    );
  }
  const hero = items.find((i) => i.sku === "FX9001" && i.image) ?? items.find((i) => i.image && (i.list ?? 0) > 1000);
  const guns = all.find((x) => /gun/i.test(x.name)) ?? all[0];
  const parts = all.find((x) => /part/i.test(x.name));
  const gunItems = (guns ? items.filter((i) => i.category_id === guns.id) : items).filter((i) => i.image).slice(0, 8);
  const partItems = (parts ? items.filter((i) => i.category_id === parts.id) : []).filter((i) => i.image).slice(0, 8);
  return (
    <>
      <section className="adc-hero ptn-hero">
        <div className="adc-wrap adc-hero-in">
          <div className="adc-hero-t">
            <span className="adc-pill"><Truck size={15} aria-hidden="true" /> {brand.tagline}</span>
            <h1>{brand.heroTitle}</h1>
            <p>{brand.heroText}</p>
            <div className="adc-hero-b">
              {guns ? <Link href={`${base}?c=${encodeURIComponent(guns.id)}`} className="adc-cta ptn-cta-light">Shop {guns.name.toLowerCase()}</Link> : null}
              <Link href={`${base}/p/${encodeURIComponent(DIAGRAMS[0]?.forSku ?? "")}`} className="adc-ghost"><Layers size={18} aria-hidden="true" /> Find a part on the gun drawing</Link>
            </div>
            {me ? <span className="ptn-hi">Welcome back, {me.contact.split(" ")[0]}. You&apos;re seeing {me.company}&apos;s prices.</span> : null}
          </div>
          {hero ? <Link href={`${base}/p/${encodeURIComponent(hero.sku)}`} className="adc-hero-ph" aria-label={hero.name}><PImg src={hero.image} alt={hero.name} /></Link> : null}
        </div>
      </section>
      <div className="adc-wrap adc-pad adc-stack">
        {!me ? (
          <Link href={`${base}/account`} className="ptn-signin-band">
            <UserRound size={22} aria-hidden="true" />
            <span><b>Have an account with us?</b> Sign in to see your prices, reorder in one tap and track every order.</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        ) : null}
        <section className="adc-stack-s" aria-label="Shop by category">
          <h2 className="adc-h2">Shop by category</h2>
          <div className="adc-catgrid">
            {all.map((x) => (
              <Link key={x.id} href={`${base}?c=${encodeURIComponent(x.id)}`} className="adc-cat">
                <PImg src={x.image} alt="" />
                <span><b>{x.name}</b><span>{x.n} {x.n === 1 ? "item" : "items"}</span></span>
              </Link>
            ))}
          </div>
        </section>
        {gunItems.length ? (
          <section className="adc-stack-s" aria-label="Guns">
            <div className="adc-sec-h"><h2 className="adc-h2">{guns?.name ?? "Guns"}</h2>{guns ? <Link href={`${base}?c=${encodeURIComponent(guns.id)}`}>See all</Link> : null}</div>
            <PGrid items={gunItems} />
          </section>
        ) : null}
        {partItems.length ? (
          <section className="adc-stack-s" aria-label="Parts">
            <div className="adc-sec-h"><h2 className="adc-h2">{parts?.name}</h2><Link href={`${base}?c=${encodeURIComponent(parts!.id)}`}>See all</Link></div>
            <PGrid items={partItems} />
          </section>
        ) : null}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ product

export function PProduct({ sku }: { sku: string }) {
  const { partner, items } = usePartner();
  const base = `/store/${partner.slug}`;
  const it = items.find((x) => x.sku.toLowerCase() === sku.toLowerCase());
  if (!it) return <div className="adc-wrap adc-pad"><h1 className="adc-h1">We couldn&apos;t find that part.</h1><p><Link href={base}>Back to the store</Link></p></div>;
  const d = diagramFor(it.sku);
  const bySku = new Map(items.map((x) => [x.sku.toLowerCase(), x]));
  const parts = d ? d.parts.map((p) => bySku.get(p.sku.toLowerCase())).filter((x): x is PItem => Boolean(x)) : [];
  const uniq = Array.from(new Map(parts.map((p) => [p.id, p])).values());
  const more = (uniq.length ? uniq : items.filter((x) => x.category_id === it.category_id && x.id !== it.id)).filter((x) => x.image).slice(0, 8);
  return (
    <div className="adc-wrap adc-pad adc-stack">
      <nav className="adc-crumbs" aria-label="Breadcrumb">
        <Link href={base}>Home</Link><span aria-hidden="true">›</span>
        {it.category_id ? <><Link href={`${base}?c=${encodeURIComponent(it.category_id)}`}>{it.category}</Link><span aria-hidden="true">›</span></> : null}
        <span>{it.name}</span>
      </nav>
      <div className="adc-prod">
        <div className="adc-prod-ph"><PImg src={it.image} alt={it.name} /></div>
        <div className="adc-prod-b">
          <span className="adc-sku">PART {it.sku}{it.category ? ` · ${it.category.toUpperCase()}` : ""}</span>
          <h1 className="adc-h1">{it.name}</h1>
          <PPrice item={it} big />
          <PBuy item={it} />
          <div className="adc-ship"><Truck size={22} aria-hidden="true" /><span><b>Ships to your shop or job site</b><span>Most parts ship the same day</span></span></div>
          <dl className="adc-facts">
            <dt>Part number</dt><dd>{it.sku}</dd>
            {it.category ? <><dt>Category</dt><dd>{it.category}</dd></> : null}
            <dt>Sold as</dt><dd>{(it.unit ?? "each").replace(/^\w/, (ch) => ch.toUpperCase())}</dd>
          </dl>
        </div>
      </div>
      {d ? (
        <section className="adc-stack-s" aria-label="Every part">
          <div className="adc-sec-h"><h2 className="adc-h2">Every part, on the drawing</h2><span className="adc-muted">Point at a part to see its number. Click it to add it to your cart.</span></div>
          <PDiagram slug={d.slug} />
        </section>
      ) : null}
      {more.length ? (
        <section className="adc-stack-s" aria-label={d ? "Parts for this gun" : "More like this"}>
          <h2 className="adc-h2">{d ? "Parts for this gun" : "More like this"}</h2>
          <PGrid items={more} />
        </section>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ cart and checkout

export function PCart() {
  const { partner, cart, byId, priceFor, setQty, me, placeOrder, ready } = usePartner();
  const router = useRouter();
  const base = `/store/${partner.slug}`;
  const [shipTo, setShipTo] = useState("");
  const [po, setPo] = useState("");
  const [note, setNote] = useState("");
  const [guest, setGuest] = useState({ name: "", email: "", phone: "" });
  const rows = cart.map((l) => {
    const it = l.id ? byId.get(l.id) : undefined;
    const price = it ? priceFor(it) : null;
    return { l, it, price, total: price === null ? null : price * l.qty };
  });
  const sub = rows.reduce((n, r) => n + (r.total ?? 0), 0);
  const tbd = rows.some((r) => r.price === null);
  if (!ready) return <div className="adc-wrap adc-pad" />;
  if (!cart.length) {
    return (
      <div className="adc-wrap adc-pad">
        <div className="adc-empty"><ShoppingCart size={28} aria-hidden="true" /><b>Your cart is empty.</b><Link href={base} className="adc-cta">Shop the store</Link></div>
      </div>
    );
  }
  const send = () => {
    const where = shipTo.trim() || (me ? `${me.company}, ${me.city}` : "");
    if (!where || (!me && (!guest.name.trim() || !guest.email.includes("@")))) return;
    const no = placeOrder({ shipTo: me ? where : `${guest.name} · ${guest.email} · ${where}`, po, note });
    router.push(`${base}/account?placed=${encodeURIComponent(no)}`);
  };
  return (
    <div className="adc-wrap adc-pad adc-stack-s">
      <h1 className="adc-h1">Your cart</h1>
      <div className="ptn-cart">
        <div className="ptn-lines">
          {rows.map(({ l, it, price, total }) => (
            <div key={keyOf(l)} className="ptn-line">
              <span className="ptn-line-ph"><PImg src={l.image} alt="" /></span>
              <span className="ptn-line-b">
                <span className="adc-sku">{l.sku}</span>
                <b>{l.name}</b>
                <span className="adc-muted small">{price === null ? (it ? "Price confirmed before it ships" : "Not in the catalog yet: we'll confirm it") : `${usd(price)} each`}</span>
              </span>
              <span className="adc-qty sm" role="group" aria-label={`Quantity of ${l.name}`}>
                <button type="button" onClick={() => setQty(keyOf(l), l.qty - 1)} aria-label="Less">{l.qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}</button>
                <input inputMode="numeric" value={l.qty} onChange={(e) => setQty(keyOf(l), Number(e.target.value.replace(/\D/g, "")) || 1)} aria-label="Quantity" />
                <button type="button" onClick={() => setQty(keyOf(l), l.qty + 1)} aria-label="More"><Plus size={16} /></button>
              </span>
              <b className="ptn-line-t">{total === null ? "TBD" : usd(total)}</b>
            </div>
          ))}
        </div>
        <aside className="ptn-check">
          <div className="ptn-sum"><span>Subtotal</span><b>{usd(sub)}{tbd ? " + TBD" : ""}</b></div>
          <span className="adc-muted small">Shipping and tax are added on your invoice.{me ? ` Billed to ${me.company} (${me.terms}).` : ""}</span>
          {me ? (
            <div className="ptn-who"><Building2 size={18} aria-hidden="true" /><span><b>{me.company}</b><span>{me.contact} · {me.email}</span></span></div>
          ) : (
            <>
              <span className="ptn-guest-h">Checking out as a guest · <Link href={`${base}/account`}>Sign in</Link></span>
              <label className="adc-f"><span>Your name</span><input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} autoComplete="name" /></label>
              <label className="adc-f"><span>Email</span><input type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} autoComplete="email" /></label>
              <label className="adc-f"><span>Phone</span><input type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} autoComplete="tel" /></label>
            </>
          )}
          <label className="adc-f"><span>Ship to</span><input value={shipTo} onChange={(e) => setShipTo(e.target.value)} placeholder={me ? `${me.company}, ${me.city}` : "Street, city, state"} /></label>
          <label className="adc-f"><span>PO number (optional)</span><input value={po} onChange={(e) => setPo(e.target.value)} /></label>
          <label className="adc-f"><span>Notes (optional)</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button type="button" className="adc-cta block" onClick={send}>Place order</button>
          <span className="adc-muted small center">Preview: the order shows up on your account and the {partner.short} desk, nowhere else.</span>
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ account (sign in, order history, prices)

export function PAccount({ placed }: { placed: string }) {
  const { partner, customers, me, signIn, orders, byId, priceFor, storePrice, add, ready, custPrices } = usePartner();
  const base = `/store/${partner.slug}`;
  const [tab, setTab] = useState<"orders" | "prices">("orders");
  const [q, setQ] = useState("");
  const mine = useMemo(() => orders.filter((o) => o.source === "store" && o.customerId === me?.id), [orders, me]);
  if (!ready) return <div className="adc-wrap adc-pad" />;
  if (!me) {
    return (
      <div className="adc-wrap adc-pad">
        <div className="ptn-signin">
          <h1 className="adc-h1">Sign in</h1>
          <p className="adc-muted" style={{ margin: 0 }}>Your account shows your prices, your orders and lets you reorder in one tap.</p>
          <label className="adc-f"><span>Email</span><input type="email" placeholder="you@company.com" disabled /></label>
          <label className="adc-f"><span>Password</span><input type="password" placeholder="••••••••" disabled /></label>
          <span className="ptn-demo-h">Preview: pick a sample customer to see their account</span>
          <div className="ptn-demo">
            {customers.map((c) => (
              <button key={c.id} type="button" onClick={() => signIn(c.id)}>
                <Building2 size={18} aria-hidden="true" />
                <span><b>{c.company}</b><span>{c.contact} · {c.city} · {c.off ? `${c.off}% off list` : "List price"}</span></span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  const own = custPrices[me.id] ?? {};
  const priced = Object.keys(own).map((id) => byId.get(id)).filter((x): x is PItem => Boolean(x));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = (words.length ? Array.from(byId.values()).filter((i) => storePrice(i) !== null && words.every((w) => `${i.sku} ${i.name}`.toLowerCase().includes(w))).slice(0, 40) : priced.length ? priced : Array.from(byId.values()).filter((i) => storePrice(i) !== null && i.image).slice(0, 12));
  const spent = mine.reduce((n, o) => n + o.lines.reduce((m, l) => m + (l.price ?? 0) * l.qty, 0), 0);
  return (
    <div className="adc-wrap adc-pad adc-stack-s">
      {placed ? <div className="ptn-ok"><CircleCheck size={20} aria-hidden="true" /><span><b>Order {placed} is in.</b> {partner.name} has it now. You&apos;ll see it below.</span></div> : null}
      <div className="ptn-acct-h">
        <span className="ptn-av" aria-hidden="true">{me.company.slice(0, 1)}</span>
        <span className="ptn-acct-t"><h1 className="adc-h1">{me.company}</h1><span className="adc-muted">{me.contact} · {me.email} · {me.terms}</span></span>
        <button type="button" className="adc-ghost dark" onClick={() => signIn(null)}><LogOut size={16} aria-hidden="true" /> Sign out</button>
      </div>
      <div className="ptn-stats">
        <span><b>{mine.length}</b><span>Orders</span></span>
        <span><b>{usd(spent)}</b><span>Ordered with us</span></span>
        <span><b>{me.off ? `${me.off}%` : "List"}</b><span>Your discount</span></span>
        <span><b>{mine.filter((o) => o.status !== "done").length}</b><span>On the way</span></span>
      </div>
      <div className="adc-chips">
        <button type="button" className={tab === "orders" ? "on" : undefined} onClick={() => setTab("orders")}>Order history</button>
        <button type="button" className={tab === "prices" ? "on" : undefined} onClick={() => setTab("prices")}>Your prices</button>
      </div>
      {tab === "orders" ? (
        mine.length ? (
          <div className="ptn-orders">{mine.map((o) => <POrderCard key={o.no} o={o} onReorder={() => o.lines.forEach((l) => add(l, l.qty))} />)}</div>
        ) : (
          <div className="adc-empty"><Package size={28} aria-hidden="true" /><b>No orders yet.</b><Link href={base} className="adc-cta">Shop the store</Link></div>
        )
      ) : (
        <div className="ptn-prices">
          <label className="adc-search light"><Search size={18} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Look up your price on any part" aria-label="Look up a price" /></label>
          {list.map((i) => {
            const mineP = priceFor(i);
            const lp = storePrice(i);
            return (
              <div key={i.id} className="ptn-price-row">
                <span className="ptn-line-ph sm"><PImg src={i.image} alt="" /></span>
                <span className="ptn-line-b"><span className="adc-sku">{i.sku}</span><b>{i.name}</b></span>
                <span className="ptn-pr"><b>{mineP === null ? "Quote" : usd(mineP)}</b>{lp !== null && mineP !== null && mineP < lp ? <s>{usd(lp)}</s> : null}{own[i.id] !== undefined ? <span className="ptn-tag">Special price</span> : null}</span>
                <button type="button" className="adc-add" onClick={() => add(i)}>Add</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function POrderCard({ o, onReorder }: { o: POrder; onReorder: () => void }) {
  const [done, setDone] = useState(false);
  const total = o.lines.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0);
  return (
    <div className="ptn-order">
      <div className="ptn-order-h">
        <span><b>{o.no}</b><span className="adc-muted small">{day(o.at)}{o.po ? ` · ${o.po}` : ""}</span></span>
        <span className={`ptn-st ${o.status}`}>{o.status === "new" ? "Received" : o.status === "shipped" ? "Shipped" : "Delivered"}</span>
      </div>
      <div className="ptn-order-ls">
        {o.lines.map((l, i) => (
          <span key={i} className="ptn-order-l"><span className="ptn-line-ph xs"><PImg src={l.image} alt="" /></span><span className="ellipsis">{l.qty} × {l.name}</span><b>{l.price === null ? "TBD" : usd(l.price * l.qty)}</b></span>
        ))}
      </div>
      <div className="ptn-order-f">
        <span className="adc-muted small">{o.tracking ? `Tracking ${o.tracking}` : o.status === "new" ? "Getting it ready" : ""}</span>
        <b>{usd(total)}</b>
        <button type="button" className={`adc-add${done ? " done" : ""}`} onClick={() => (onReorder(), setDone(true))}>{done ? <><CircleCheck size={16} /> In your cart</> : <><RotateCcw size={16} /> Order again</>}</button>
      </div>
    </div>
  );
}
