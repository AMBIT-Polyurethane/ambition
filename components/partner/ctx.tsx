"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { pdict, type Lang, type PartnerDict } from "@/lib/partner-i18n";

/** What every page of a partner's store needs on the shopper's side (no costs, nothing private). */
export type PStore = {
  slug: string;
  name: string;
  short: string;
  phone: string;
  email: string;
  logo: string | null;
  color: string;
  color2: string;
  /** Shipping the owner set (null: quoted on each order). */
  shipFlat: number | null;
  shipFreeOver: number | null;
  shipNote: string | null;
};
export type PWho = { kind: "guest" | "owner" | "customer" | "viewer" | "other"; first: string | null; company: string | null; terms: string | null };

export type PCartLine = { key: string; id: string | null; sku: string; name: string; qty: number; image?: string | null };

type Ctx = {
  store: PStore;
  base: string;
  lang: Lang;
  t: PartnerDict;
  who: PWho;
  lines: PCartLine[];
  count: number;
  ready: boolean;
  flash: string | null;
  add: (l: Omit<PCartLine, "key" | "qty">, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
};

const C = createContext<Ctx | null>(null);

export function PartnerProvider({ store, lang, who, children }: { store: PStore; lang: Lang; who: PWho; children: React.ReactNode }) {
  const KEY = `ptn-cart-${store.slug}-v1`;
  const [lines, setLines] = useState<PCartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(v)) setLines(v.filter((l) => l && typeof l.sku === "string" && Number(l.qty) > 0).slice(0, 120));
    } catch {}
    setReady(true);
  }, [KEY]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {}
  }, [lines, ready, KEY]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  const add = useCallback((l: Omit<PCartLine, "key" | "qty">, qty = 1) => {
    const key = l.id ?? `sku:${l.sku}`;
    setLines((cur) => {
      const have = cur.find((x) => x.key === key);
      if (have) return cur.map((x) => (x.key === key ? { ...x, qty: Math.min(9999, x.qty + qty) } : x));
      return [...cur, { ...l, key, qty }].slice(0, 120);
    });
    setFlash(l.name);
  }, []);
  const setQty = useCallback((key: string, qty: number) => {
    setLines((cur) => (qty <= 0 ? cur.filter((x) => x.key !== key) : cur.map((x) => (x.key === key ? { ...x, qty: Math.min(9999, Math.round(qty)) } : x))));
  }, []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(
    () => ({ store, base: `/store/${store.slug}`, lang, t: pdict(lang), who, lines, count: lines.reduce((n, l) => n + l.qty, 0), ready, flash, add, setQty, clear }),
    [store, lang, who, lines, ready, flash, add, setQty, clear],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function usePartner(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("usePartner outside PartnerProvider");
  return c;
}

export { usd } from "@/lib/partner-i18n";
