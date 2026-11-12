"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Minus, Plus, Search, Trash2 } from "lucide-react";
import { money } from "@/lib/format";
import { addItemsByLink } from "@/app/approve/actions";

export type Option = { id: string; sku: string; name: string; unit: string; price: number | null; account: boolean; foam: boolean; n: number; cat: string | null };

/** Pick quantities, then "Add to my order". Most ordered at the location first, then search everything else. */
export function AddItems({ token, options, start, branchName }: { token: string; options: Option[]; start: string | null; branchName: string }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(() => (start && options.some((o) => o.id === start) ? { [start]: 1 } : {}));
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const top = options.filter((o) => o.n > 0).slice(0, 10);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rest = useMemo(
    () => (words.length ? options.filter((o) => words.every((w) => `${o.sku} ${o.name} ${o.cat ?? ""}`.toLowerCase().includes(w))).slice(0, 40) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, options],
  );
  const picked = options.filter((o) => (qty[o.id] ?? 0) > 0);
  const total = picked.reduce((s, o) => s + (o.price && !o.account ? o.price * qty[o.id] : 0), 0);
  const set = (id: string, n: number) => setQty((m) => ({ ...m, [id]: Math.max(0, Math.min(1000, Math.floor(n))) }));

  const row = (o: Option) => {
    const n = qty[o.id] ?? 0;
    return (
      <div key={o.id} className="product">
        <div className="grow">
          <div className="name">{o.name}</div>
          <div className="desc">{o.sku}{o.n > 1 ? ` · on ${o.n} orders at ${branchName} lately` : ""}</div>
          <div style={{ marginTop: 4, fontSize: 14 }}>{o.account || o.price === null ? <span className="cp-tag">Account pricing</span> : <><b>{money(o.price)}</b> <span className="tiny faint">/ {o.unit}</span></>}</div>
        </div>
        {n > 0 ? (
          <div className="stepper">
            <button type="button" aria-label={`One less ${o.name}`} onClick={() => set(o.id, n - 1)}>{n <= 1 ? <Trash2 size={16} /> : <Minus size={16} />}</button>
            <input aria-label={`Quantity of ${o.name}`} inputMode="numeric" type="number" min={0} value={n} onChange={(e) => set(o.id, Number(e.target.value) || 0)} onFocus={(e) => e.target.select()} />
            <button type="button" aria-label={`One more ${o.name}`} onClick={() => set(o.id, n + 1)}><Plus size={16} /></button>
          </div>
        ) : (
          <button type="button" className="add" onClick={() => set(o.id, 1)} aria-label={`Add ${o.name}`}>ADD</button>
        )}
      </div>
    );
  };

  const save = () =>
    go(async () => {
      setError(null);
      const res = await addItemsByLink(token, picked.map((o) => ({ product_id: o.id, qty: qty[o.id] })));
      if (!res.ok) return setError(res.error);
      router.push(`/approve/${token}?added=${picked.length}`);
    });

  return (
    <>
      {top.length ? (
        <section className="section">
          <div className="eyebrow">Most ordered at {branchName}</div>
          <div className="list">{top.map(row)}</div>
        </section>
      ) : null}
      <section className="section">
        <div className="eyebrow">Something else</div>
        <div className="search">
          <Search size={18} />
          <input className="input" type="search" placeholder="Search products or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        {words.length ? (rest.length ? <div className="list">{rest.map(row)}</div> : <div className="card muted small center">Nothing matches. Your AMBIT rep can add anything else.</div>) : null}
      </section>
      <p className="tiny faint" style={{ margin: 0 }}>
        Spray foam is billed at your account pricing. Prices shown are list prices; final pricing, tax and freight are on your AMBIT invoice.
      </p>
      {error ? <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div> : null}
      <div className="cartbar" style={{ bottom: 12 }}>
        <div className="inner">
          <button type="button" className="btn" disabled={!picked.length || pending} onClick={save}>
            <span className="count">{picked.length} {picked.length === 1 ? "item" : "items"}</span>
            <span>{pending ? "Adding…" : "Add to my order"}</span>
            <span style={{ minWidth: 60, textAlign: "right", letterSpacing: 0 }}>{total > 0 ? money(total) : ""}</span>
          </button>
        </div>
      </div>
      <a href={`/approve/${token}`} className="btn dark block">Back to the order</a>
      <div style={{ height: 70 }} />
    </>
  );
}
