"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Building2, Check, CircleCheck, ImageUp, Package, Palette, PlugZap, RotateCcw, Search, Send, Tags, Truck, UserPlus, Users } from "lucide-react";
import { usePartner, usd, type POrder } from "@/components/partner/store";
import { PImg } from "@/components/partner/ui";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const TABS = [
  ["orders", "Orders", Package],
  ["customers", "Customers & prices", Users],
  ["look", "Store look", Palette],
  ["ambit", "AMBIT drop-ship", PlugZap],
] as const;
type Tab = (typeof TABS)[number][0];
const PRESETS = [["#2d694b", "#24563d"], ["#1f4e8c", "#183f71"], ["#b3261e", "#8f1e18"], ["#3b3b42", "#26262b"], ["#c26a00", "#9c5500"]];

/** The partner's own back office: their orders (theirs and AMBIT's drop-ships), customers and prices, and how the store looks. */
export function PDesk() {
  const { partner, brand, orders, ready, reset } = usePartner();
  const [tab, setTab] = useState<Tab>("orders");
  const newN = orders.filter((o) => o.status === "new").length;
  if (!ready) return <div className="adc-wrap adc-pad" />;
  return (
    <div className="adc-wrap adc-pad adc-stack-s ptn-desk">
      <div className="ptn-desk-h">
        <Link href={`/store/${partner.slug}`} className="ptn-back" aria-label="Back to the store"><ArrowLeft size={20} /></Link>
        <span><h1 className="adc-h1">{brand.name} desk</h1><span className="adc-muted">Orders, customers, prices and your store, in one place.</span></span>
        <button type="button" className="adc-ghost dark" onClick={reset} title="Put the sample data back the way it started"><RotateCcw size={16} aria-hidden="true" /> Start the preview over</button>
      </div>
      <div className="adc-chips ptn-tabs" role="tablist">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>
            <Icon size={16} aria-hidden="true" /> {label}{k === "orders" && newN ? <span className="ptn-n">{newN}</span> : null}
          </button>
        ))}
      </div>
      {tab === "orders" ? <Orders /> : tab === "customers" ? <Customers /> : tab === "look" ? <Look /> : <Ambit />}
    </div>
  );
}

function Orders() {
  const { orders, customers, update } = usePartner();
  const [show, setShow] = useState<"open" | "all" | "ambit">("open");
  const shown = orders.filter((o) => (show === "all" ? true : show === "ambit" ? o.source === "ambit" : o.status !== "done"));
  const set = (no: string, p: Partial<POrder>) => update((s) => ({ ...s, orders: s.orders.map((o) => (o.no === no ? { ...o, ...p } : o)) }));
  const week = orders.filter((o) => Date.now() - new Date(o.at).getTime() < 7 * 864e5);
  const sales = week.filter((o) => o.source === "store").reduce((n, o) => n + o.lines.reduce((m, l) => m + (l.price ?? 0) * l.qty, 0), 0);
  return (
    <>
      <div className="ptn-stats">
        <span><b>{orders.filter((o) => o.status === "new").length}</b><span>New, to ship</span></span>
        <span><b>{week.length}</b><span>Orders this week</span></span>
        <span><b>{usd(sales)}</b><span>Store sales this week</span></span>
        <span><b>{orders.filter((o) => o.source === "ambit").length}</b><span>Drop-ships for AMBIT</span></span>
      </div>
      <div className="adc-chips">
        {([["open", "Open"], ["ambit", "From AMBIT"], ["all", "All"]] as const).map(([k, l]) => <button key={k} type="button" className={show === k ? "on" : undefined} onClick={() => setShow(k)}>{l}</button>)}
      </div>
      <div className="ptn-orders">
        {shown.map((o) => {
          const c = customers.find((x) => x.id === o.customerId);
          const total = o.lines.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0);
          return (
            <div key={o.no} className={`ptn-order${o.source === "ambit" ? " ambit" : ""}`}>
              <div className="ptn-order-h">
                <span>
                  <b>{o.no}</b>
                  <span className="adc-muted small">{day(o.at)} · {o.source === "ambit" ? "AMBIT web store: ship it for AMBIT" : c ? c.company : "Guest"}{o.po ? ` · ${o.po}` : ""}</span>
                </span>
                {o.source === "ambit" ? <span className="ptn-src"><Truck size={13} aria-hidden="true" /> Drop-ship</span> : null}
                <span className={`ptn-st ${o.status}`}>{o.status === "new" ? "New" : o.status === "shipped" ? "Shipped" : "Done"}</span>
              </div>
              <div className="adc-muted small">Ship to: {o.shipTo}{o.note ? ` · ${o.note}` : ""}</div>
              <div className="ptn-order-ls">
                {o.lines.map((l, i) => (
                  <span key={i} className="ptn-order-l"><span className="ptn-line-ph xs"><PImg src={l.image} alt="" /></span><span className="ellipsis">{l.qty} × {l.sku} · {l.name}</span><b>{o.source === "ambit" ? "AMBIT PO" : l.price === null ? "TBD" : usd(l.price * l.qty)}</b></span>
                ))}
              </div>
              <div className="ptn-order-f">
                {o.status === "new" ? (
                  <ShipBox onShip={(t) => set(o.no, { status: "shipped", tracking: t })} ambit={o.source === "ambit"} />
                ) : (
                  <span className="adc-muted small">{o.tracking ? `Tracking ${o.tracking}${o.source === "ambit" ? " · sent to AMBIT" : " · emailed to the customer"}` : "Delivered"}</span>
                )}
                {o.source === "store" ? <b>{usd(total)}</b> : null}
                {o.status === "shipped" ? <button type="button" className="adc-add" onClick={() => set(o.no, { status: "done" })}><Check size={16} /> Mark delivered</button> : null}
              </div>
            </div>
          );
        })}
        {!shown.length ? <div className="adc-empty"><Package size={28} aria-hidden="true" /><b>Nothing here.</b></div> : null}
      </div>
    </>
  );
}

function ShipBox({ onShip, ambit }: { onShip: (tracking: string) => void; ambit: boolean }) {
  const [t, setT] = useState("");
  return (
    <span className="ptn-ship">
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Tracking # (optional)" aria-label="Tracking number" />
      <button type="button" className="adc-add" onClick={() => onShip(t.trim())}><Send size={15} /> {ambit ? "Shipped: tell AMBIT" : "Mark shipped"}</button>
    </span>
  );
}

function Customers() {
  const { customers, custPrices, items, storePrice, priceFor, update, orders } = usePartner();
  const [pick, setPick] = useState<string>(customers[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const c = customers.find((x) => x.id === pick) ?? null;
  const own = (c && custPrices[c.id]) || {};
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo(() => {
    const priced = items.filter((i) => storePrice(i) !== null);
    if (words.length) return priced.filter((i) => words.every((w) => `${i.sku} ${i.name} ${i.category ?? ""}`.toLowerCase().includes(w))).slice(0, 60);
    const set = priced.filter((i) => own[i.id] !== undefined);
    return [...set, ...priced.filter((i) => own[i.id] === undefined && i.image).slice(0, Math.max(0, 14 - set.length))];
  }, [items, storePrice, words.join(" "), own]); // eslint-disable-line react-hooks/exhaustive-deps
  const setOff = (v: string) => c && update((s) => ({ ...s, customers: s.customers.map((x) => (x.id === c.id ? { ...x, off: Math.max(0, Math.min(60, Number(v.replace(/[^\d.]/g, "")) || 0)) } : x)) }));
  const setPrice = (id: string, v: string) =>
    c &&
    update((s) => {
      const cur = { ...(s.custPrices[c.id] ?? {}) };
      const n = Number(v.replace(/[^\d.]/g, ""));
      if (!v.trim() || !Number.isFinite(n) || n <= 0) delete cur[id];
      else cur[id] = Math.round(n * 100) / 100;
      return { ...s, custPrices: { ...s.custPrices, [c.id]: cur } };
    });
  return (
    <div className="ptn-cust">
      <aside className="ptn-cust-list">
        {customers.map((x) => {
          const n = orders.filter((o) => o.customerId === x.id).length;
          return (
            <button key={x.id} type="button" className={x.id === pick ? "on" : undefined} onClick={() => setPick(x.id)}>
              <Building2 size={18} aria-hidden="true" />
              <span><b>{x.company}</b><span>{x.contact} · {n} {n === 1 ? "order" : "orders"}</span></span>
            </button>
          );
        })}
        {adding ? <NewCustomer onDone={(id) => (setAdding(false), id && setPick(id))} /> : <button type="button" className="ptn-addc" onClick={() => setAdding(true)}><UserPlus size={17} aria-hidden="true" /> Add a customer</button>}
        <span className="adc-muted small">Each customer gets their own sign-in. They see these prices and their own orders.</span>
      </aside>
      {c ? (
        <section className="ptn-cust-b">
          <div className="ptn-cust-h">
            <span><b>{c.company}</b><span className="adc-muted small">{c.contact} · {c.email} · {c.phone} · {c.city} · {c.terms}</span></span>
            <label className="ptn-off">Everything <input value={String(c.off)} onChange={(e) => setOff(e.target.value)} inputMode="decimal" aria-label="Percent off list on everything" /> % off list</label>
          </div>
          <label className="adc-search light"><Search size={18} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a part to give them a special price" aria-label="Find a part" /></label>
          <div className="ptn-ptable">
            <span className="ptn-ptable-h"><span>Item</span><span>Store price</span><span>Their price</span><span>Special price</span></span>
            {rows.map((i) => {
              const sp = storePrice(i);
              const theirs = priceFor(i, c.id);
              return (
                <div key={i.id} className={`ptn-prow${own[i.id] !== undefined ? " set" : ""}`}>
                  <span className="ptn-prow-i"><span className="ptn-line-ph xs"><PImg src={i.image} alt="" /></span><span className="ptn-line-b"><span className="adc-sku">{i.sku}</span><b className="ellipsis">{i.name}</b></span></span>
                  <span className="num">{sp === null ? "Quote" : usd(sp)}</span>
                  <b className="num">{theirs === null ? "Quote" : usd(theirs)}</b>
                  <span className="ptn-sp"><span>$</span><input defaultValue={own[i.id] ?? ""} key={`${c.id}-${i.id}-${own[i.id] ?? ""}`} onBlur={(e) => setPrice(i.id, e.target.value)} inputMode="decimal" placeholder={theirs === null ? "" : theirs.toFixed(2)} aria-label={`Special price for ${i.name}`} /></span>
                </div>
              );
            })}
          </div>
          <span className="adc-muted small"><Tags size={13} aria-hidden="true" /> A special price beats the % off. Leave it empty to use the % off list.</span>
        </section>
      ) : null}
    </div>
  );
}

function NewCustomer({ onDone }: { onDone: (id: string | null) => void }) {
  const { update } = usePartner();
  const [f, setF] = useState({ company: "", contact: "", email: "", city: "" });
  const save = () => {
    if (!f.company.trim()) return onDone(null);
    const id = `c${Date.now().toString(36)}`;
    update((s) => ({ ...s, customers: [...s.customers, { id, company: f.company.trim(), contact: f.contact.trim() || "Buyer", email: f.email.trim(), phone: "", city: f.city.trim(), terms: "Net 30", off: 0 }] }));
    onDone(id);
  };
  return (
    <div className="ptn-newc">
      {(["company", "contact", "email", "city"] as const).map((k) => (
        <label key={k} className="adc-f"><span>{{ company: "Company", contact: "Buyer's name", email: "Email (their sign-in)", city: "City, state" }[k]}</span><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="adc-add" onClick={save}><Check size={16} /> Add</button>
        <button type="button" className="adc-ghost dark" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

function Look() {
  const { brand, update, partner } = usePartner();
  const set = (p: Partial<typeof brand>) => update((s) => ({ ...s, brand: { ...s.brand, ...p } }));
  const [err, setErr] = useState("");
  const logo = (f: File | undefined) => {
    setErr("");
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type) || f.size > 1_500_000) return setErr("Use a PNG, JPG, WEBP or SVG under 1.5 MB.");
    const r = new FileReader();
    r.onload = () => set({ logo: String(r.result) });
    r.readAsDataURL(f);
  };
  return (
    <div className="ptn-look">
      <section className="ptn-card">
        <b className="ptn-card-h"><ImageUp size={18} aria-hidden="true" /> Logo</b>
        <div className="ptn-logo-prev" style={{ background: brand.color }}>{brand.logo ? <img src={brand.logo} alt="" /> : <b>{brand.name}</b>}</div>
        <label className="adc-ghost dark ptn-file">Upload a logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => logo(e.target.files?.[0])} /></label>
        {err ? <span className="adc-err">{err}</span> : null}
        <button type="button" className="ptn-linkbtn" onClick={() => set({ logo: partner.logo })}>Use the original logo</button>
      </section>
      <section className="ptn-card">
        <b className="ptn-card-h"><Palette size={18} aria-hidden="true" /> Colors</b>
        <div className="ptn-swatches">
          {PRESETS.map(([a, b]) => <button key={a} type="button" className={brand.color === a ? "on" : undefined} style={{ background: a }} onClick={() => set({ color: a, color2: b })} aria-label={`Use ${a}`} />)}
          <label className="ptn-pick">Any color <input type="color" value={brand.color} onChange={(e) => set({ color: e.target.value, color2: e.target.value })} /></label>
        </div>
        <span className="adc-muted small">The header, buttons and links change right away. Look at the top of this page.</span>
      </section>
      <section className="ptn-card wide">
        <b className="ptn-card-h">Words on the store</b>
        <label className="adc-f"><span>Store name</span><input value={brand.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="adc-f"><span>Tagline</span><input value={brand.tagline} onChange={(e) => set({ tagline: e.target.value })} /></label>
        <label className="adc-f"><span>Big headline on the home page</span><input value={brand.heroTitle} onChange={(e) => set({ heroTitle: e.target.value })} /></label>
        <label className="adc-f"><span>Under the headline</span><textarea rows={2} value={brand.heroText} onChange={(e) => set({ heroText: e.target.value })} /></label>
        <Link href={`/store/${partner.slug}`} className="adc-cta" style={{ alignSelf: "flex-start" }}>See the store</Link>
      </section>
    </div>
  );
}

function Ambit() {
  const { dropship, update, items, isDropship, orders } = usePartner();
  const covered = items.filter(isDropship);
  const set = (p: Partial<typeof dropship>) => update((s) => ({ ...s, dropship: { ...s.dropship, ...p } }));
  const simulate = () =>
    update((s) => {
      const pool = covered.filter((i) => i.list !== null && i.image);
      const a = pool[Math.floor(Math.random() * pool.length)];
      const b = pool[Math.floor(Math.random() * pool.length)];
      const n = Math.max(1007, ...s.orders.filter((o) => o.source === "ambit").map((o) => Number(o.no.split("-")[1]) || 0)) + 1;
      const lines = [a, b].filter(Boolean).filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i).map((i) => ({ id: i.id, sku: i.sku, name: i.name, image: i.image, qty: 1, price: null }));
      return { ...s, orders: [{ no: `ADC-${n}`, at: new Date().toISOString(), source: "ambit", customerId: null, shipTo: "Sample Spray Foam LLC, 400 Main St, Tulsa, OK", po: "AMBIT web order", lines, status: "new", tracking: "", note: "Just came in from AMBIT's web store" }, ...s.orders] };
    });
  const last = orders.find((o) => o.source === "ambit");
  return (
    <div className="ptn-look">
      <section className="ptn-card wide">
        <b className="ptn-card-h"><PlugZap size={18} aria-hidden="true" /> Gun-part orders from AMBIT</b>
        <p className="adc-muted" style={{ margin: 0 }}>
          When a contractor buys gun parts on AMBIT&apos;s ADC web store, AMBIT sends the order here and to your email right away. You ship it
          straight to the contractor, type the tracking number, and AMBIT and the contractor both get it. No phone calls, no re-typing.
        </p>
        <label className="ptn-toggle"><input type="checkbox" checked={dropship.on} onChange={(e) => set({ on: e.target.checked })} /> <b>Send me AMBIT&apos;s gun-part orders</b></label>
        <label className="adc-f"><span>Email them to</span><input type="email" value={dropship.email} onChange={(e) => set({ email: e.target.value })} /></label>
        <span className="adc-muted small">{covered.length} items on AMBIT&apos;s store come to you (guns, gun parts, hoses, tips, seals and kits).</span>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="adc-cta" onClick={simulate} disabled={!dropship.on}><Truck size={18} aria-hidden="true" /> Show me one arriving</button>
          {last ? <span className="adc-muted small"><CircleCheck size={14} aria-hidden="true" /> Latest: {last.no}, {day(last.at)}. See it under Orders.</span> : null}
        </div>
      </section>
      <section className="ptn-card wide ptn-flow">
        <b className="ptn-card-h">How it works</b>
        <ol>
          <li><b>A contractor orders on AMBIT&apos;s web store.</b> Foam and supplies ship from AMBIT; gun parts are marked for you.</li>
          <li><b>You get the order in seconds:</b> here on your desk and by email, with the ship-to address and AMBIT&apos;s PO.</li>
          <li><b>You ship it and type the tracking number.</b> AMBIT&apos;s order updates and the contractor is told it&apos;s on the way.</li>
          <li><b>You bill AMBIT</b> at your agreed price, the same way you do today.</li>
        </ol>
      </section>
    </div>
  );
}
