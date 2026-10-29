"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Minus, Plus, ShoppingCart } from "lucide-react";
import { readCart, writeCart } from "@/lib/cart";
import type { Needs } from "@/lib/ops/materials";

/** The AMBIT products a job needs, rounded up to whole drums and bags; change any amount, then order. */
export function MaterialList({ title, needs, staff }: { title: string; needs: Needs; staff: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(needs.rows.map((r) => [r.product_id, r.qty])));
  const set = (id: string, v: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(9999, Math.round(v))) }));
  const count = Object.values(qty).filter((v) => v > 0).length;
  const order = () => {
    const cart = readCart();
    for (const [id, n] of Object.entries(qty)) if (n > 0) cart[id] = (cart[id] ?? 0) + n;
    writeCart(cart);
    router.push("/order");
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col tight">
        <b style={{ fontSize: 18 }}>{title}</b>
        <span className="small muted">Spray foam is rounded up to whole sets (an ISO drum and a resin drum each); blown and batts to whole bags. Take off anything already on your rig or in the shop.</span>
      </div>
      {needs.rows.length ? (
        <div className="list">
          {needs.rows.map((r) => (
            <div key={r.key} className="item mat-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t ellipsis">{r.name}</div>
                <div className="s ellipsis">{r.sku} · needs {r.exact.toLocaleString("en-US", { maximumFractionDigits: 2 })} · {r.why}</div>
              </div>
              <div className="mat-qty" role="group" aria-label={`How many ${r.name}`}>
                <button type="button" onClick={() => set(r.product_id, (qty[r.product_id] ?? 0) - 1)} aria-label="One less"><Minus size={15} /></button>
                <input inputMode="numeric" value={qty[r.product_id] ?? 0} onChange={(e) => set(r.product_id, Number(e.target.value.replace(/\D/g, "")) || 0)} aria-label="Quantity" />
                <button type="button" onClick={() => set(r.product_id, (qty[r.product_id] ?? 0) + 1)} aria-label="One more"><Plus size={15} /></button>
                <span className="tiny faint">{r.unit}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card small muted">Nothing to order from AMBIT yet: the lines need sizes, depths or R-values, and AMBIT products picked.</div>
      )}
      {needs.elsewhere.length ? (
        <div className="alert info small">
          <span>Not from AMBIT (buy these where you usually do): {needs.elsewhere.map((e) => `${e.name} (${e.exact} ${e.unit})`).join(", ")}.</span>
        </div>
      ) : null}
      {needs.missing.length ? (
        <div className="alert warn small"><AlertTriangle size={15} style={{ flex: "none", marginTop: 1 }} /><span>Couldn&apos;t find these in AMBIT&apos;s catalog: {needs.missing.join(", ")}. Add them by hand on the order.</span></div>
      ) : null}
      <button type="button" className="btn" disabled={!count} onClick={order}>
        <ShoppingCart size={17} /> Put {count} item{count === 1 ? "" : "s"} in my AMBIT order
      </button>
      <span className="tiny faint">{staff ? "They go in the order cart; pick the customer and location next." : "They're added to your cart; you pick the location, delivery and date next, like any AMBIT order."}</span>
    </div>
  );
}
