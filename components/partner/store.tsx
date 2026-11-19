"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Partner, PartnerCustomer } from "@/lib/partners";

// A partner's preview store. Everything a shopper or the partner's staff changes (the look, customers, prices, orders,
// the cart) lives in this browser only, so it can be shown to the partner without touching AMBIT's real data.

export type PItem = { id: string; sku: string; name: string; image: string | null; list: number | null; quote: boolean; category: string | null; category_id: string | null; unit: string | null };
export type PLine = { id: string | null; sku: string; name: string; image: string | null; qty: number; price: number | null };
export type POrder = {
  no: string;
  at: string;
  /** "store": a customer of the partner ordered here. "ambit": AMBIT's web store sold it and the partner ships it (drop-ship). */
  source: "store" | "ambit";
  customerId: string | null;
  shipTo: string;
  po: string;
  lines: PLine[];
  status: "new" | "shipped" | "done";
  tracking: string;
  note: string;
};
export type Brand = { name: string; tagline: string; color: string; color2: string; logo: string; heroTitle: string; heroText: string };
type State = {
  v: 1;
  brand: Brand;
  customers: PartnerCustomer[];
  storePrices: Record<string, number>;
  custPrices: Record<string, Record<string, number>>;
  orders: POrder[];
  signedIn: string | null;
  cart: PLine[];
  dropship: { on: boolean; email: string; words: string[] };
};

type Ctx = State & {
  ready: boolean;
  partner: Partner;
  items: PItem[];
  byId: Map<string, PItem>;
  me: PartnerCustomer | null;
  storePrice: (i: PItem) => number | null;
  priceFor: (i: PItem, customerId?: string | null) => number | null;
  signIn: (id: string | null) => void;
  add: (i: { id: string | null; sku: string; name: string; image: string | null }, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  clearCart: () => void;
  placeOrder: (o: { shipTo: string; po: string; note: string }) => string;
  update: (fn: (s: State) => State) => void;
  reset: () => void;
  flash: string | null;
  isDropship: (i: PItem) => boolean;
};

const C = createContext<Ctx | null>(null);
const r2 = (n: number) => Math.round(n * 100) / 100;
const lineKey = (l: { id: string | null; sku: string }) => l.id ?? `sku:${l.sku}`;

/** A few believable orders so the account pages and the partner's desk aren't empty on the first visit. */
function seed(p: Partner, items: PItem[]): State {
  const priced = items.filter((i) => i.list !== null && !i.quote);
  const parts = priced.filter((i) => i.image && i.list! < 400);
  const pick = (n: number, k: number) => Array.from({ length: n }, (_, j) => parts[(k * 7 + j * 13) % Math.max(1, parts.length)]).filter(Boolean);
  const day = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
  const orders: POrder[] = [];
  let no = 2040;
  p.customers.forEach((c, ci) => {
    [38, 17, 4].slice(0, 3 - (ci === 2 ? 1 : 0)).forEach((d, oi) => {
      const lines = pick(2 + ((ci + oi) % 3), ci * 3 + oi).map((i, j) => ({ id: i.id, sku: i.sku, name: i.name, image: i.image, qty: 1 + ((j + oi) % 3), price: r2(i.list! * (1 - c.off / 100)) }));
      orders.push({ no: `${p.short}-${no++}`, at: day(d + ci), source: "store", customerId: c.id, shipTo: `${c.company}, ${c.city}`, po: oi === 1 ? `PO ${4400 + ci * 10 + oi}` : "", lines, status: d > 10 ? "done" : "shipped", tracking: d > 10 ? "" : `1Z${(908000 + ci * 37 + oi).toString(36).toUpperCase()}`, note: "" });
    });
  });
  const ds = pick(3, 9);
  orders.push({ no: "ADC-1007", at: day(0.2), source: "ambit", customerId: null, shipTo: "Lone Star Foam LLC, 1200 Industrial Blvd, Denton, TX", po: "AMBIT web order", lines: ds.slice(0, 2).map((i) => ({ id: i.id, sku: i.sku, name: i.name, image: i.image, qty: 1, price: null })), status: "new", tracking: "", note: "Ship by Friday" });
  orders.push({ no: "ADC-1004", at: day(2), source: "ambit", customerId: null, shipTo: "Gulf Coast Insulators, 88 Harbor Rd, Mobile, AL", po: "AMBIT web order", lines: ds.slice(1, 3).map((i) => ({ id: i.id, sku: i.sku, name: i.name, image: i.image, qty: 2, price: null })), status: "shipped", tracking: "1Z77AMB4", note: "" });
  return {
    v: 1,
    brand: { name: p.name, tagline: p.tagline, color: p.color, color2: p.color2, logo: p.logo, heroTitle: p.heroTitle, heroText: p.heroText },
    customers: p.customers,
    storePrices: {},
    custPrices: {},
    orders: orders.sort((a, b) => b.at.localeCompare(a.at)),
    signedIn: null,
    cart: [],
    dropship: { on: true, email: p.email, words: p.dropshipWords },
  };
}

export function PartnerProvider({ partner, items, children }: { partner: Partner; items: PItem[]; children: React.ReactNode }) {
  const KEY = `partner-preview-${partner.slug}-v1`;
  const [s, setS] = useState<State>(() => seed(partner, items));
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (v && v.v === 1) setS((cur) => ({ ...cur, ...v, brand: { ...cur.brand, ...v.brand } }));
    } catch {}
    setReady(true);
  }, [KEY]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [s, ready, KEY]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const storePrice = useCallback((i: PItem) => (i.quote || i.list === null ? null : s.storePrices[i.id] ?? i.list), [s.storePrices]);
  const priceFor = useCallback(
    (i: PItem, customerId?: string | null) => {
      const base = storePrice(i);
      const cid = customerId === undefined ? s.signedIn : customerId;
      if (!cid) return base;
      const own = s.custPrices[cid]?.[i.id];
      if (own !== undefined) return own;
      const c = s.customers.find((x) => x.id === cid);
      return base === null ? null : r2(base * (1 - (c?.off ?? 0) / 100));
    },
    [storePrice, s.custPrices, s.customers, s.signedIn],
  );
  const update = useCallback((fn: (st: State) => State) => setS((cur) => fn(cur)), []);
  const value: Ctx = {
    ...s,
    ready,
    partner,
    items,
    byId,
    me: s.customers.find((c) => c.id === s.signedIn) ?? null,
    storePrice,
    priceFor,
    flash,
    isDropship: (i) => s.dropship.words.some((w) => `${i.category ?? ""}`.toLowerCase().includes(w)),
    signIn: (id) => setS((cur) => ({ ...cur, signedIn: id })),
    add: (i, qty = 1) => {
      setS((cur) => {
        const k = lineKey(i);
        const have = cur.cart.find((l) => lineKey(l) === k);
        const cart = have ? cur.cart.map((l) => (lineKey(l) === k ? { ...l, qty: Math.min(9999, l.qty + qty) } : l)) : [...cur.cart, { ...i, qty, price: null }];
        return { ...cur, cart };
      });
      setFlash(i.name);
    },
    setQty: (key, qty) => setS((cur) => ({ ...cur, cart: qty <= 0 ? cur.cart.filter((l) => lineKey(l) !== key) : cur.cart.map((l) => (lineKey(l) === key ? { ...l, qty: Math.min(9999, Math.round(qty)) } : l)) })),
    clearCart: () => setS((cur) => ({ ...cur, cart: [] })),
    placeOrder: ({ shipTo, po, note }) => {
      const n = Math.max(2040, ...s.orders.filter((o) => o.source === "store").map((o) => Number(o.no.split("-")[1]) || 0)) + 1;
      const no = `${partner.short}-${n}`;
      setS((cur) => ({
        ...cur,
        cart: [],
        orders: [
          {
            no, at: new Date().toISOString(), source: "store", customerId: cur.signedIn, shipTo, po, note, status: "new", tracking: "",
            lines: cur.cart.map((l) => {
              const it = l.id ? byId.get(l.id) : undefined;
              return { ...l, price: it ? priceFor(it) : null };
            }),
          },
          ...cur.orders,
        ],
      }));
      return no;
    },
    update,
    reset: () => {
      try {
        localStorage.removeItem(KEY);
      } catch {}
      setS(seed(partner, items));
    },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function usePartner(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("usePartner outside PartnerProvider");
  return c;
}

export const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const keyOf = lineKey;
