"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** A cart line: a catalog item (id), or a part from a parts diagram that isn't in the catalog yet (sku + name). */
export type CartLine = { key: string; id: string | null; sku: string; name: string; qty: number; image?: string | null };

type Cart = {
  lines: CartLine[];
  count: number;
  add: (l: Omit<CartLine, "key" | "qty">, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  ready: boolean;
  /** The little "Added" note in the header. */
  flash: string | null;
};

const KEY = "adc-cart-v1";
const Ctx = createContext<Cart | null>(null);

export function AdcCartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(v)) setLines(v.filter((l) => l && typeof l.sku === "string" && Number(l.qty) > 0).slice(0, 120));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {}
  }, [lines, ready]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  const add = useCallback((l: Omit<CartLine, "key" | "qty">, qty = 1) => {
    const key = l.id ?? `sku:${l.sku}`;
    setLines((cur) => {
      const have = cur.find((x) => x.key === key);
      if (have) return cur.map((x) => (x.key === key ? { ...x, qty: Math.min(9999, x.qty + qty) } : x));
      return [...cur, { ...l, key, qty }];
    });
    setFlash(l.name);
  }, []);
  const setQty = useCallback((key: string, qty: number) => {
    setLines((cur) => (qty <= 0 ? cur.filter((x) => x.key !== key) : cur.map((x) => (x.key === key ? { ...x, qty: Math.min(9999, Math.round(qty)) } : x))));
  }, []);
  const clear = useCallback(() => setLines([]), []);
  const value = useMemo(() => ({ lines, count: lines.reduce((n, l) => n + l.qty, 0), add, setQty, clear, ready, flash }), [lines, add, setQty, clear, ready, flash]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdcCart(): Cart {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAdcCart outside AdcCartProvider");
  return c;
}
