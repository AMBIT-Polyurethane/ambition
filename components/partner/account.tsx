"use client";

import { useState } from "react";
import { CircleCheck, RotateCcw } from "lucide-react";
import { usePartner, usd } from "@/components/partner/ctx";
import { PImg } from "@/components/partner/ui";

export type POrderView = {
  no: string;
  at: string;
  status: string;
  tracking: string | null;
  po: string | null;
  subtotal: number;
  has_quote: boolean;
  lines: { item_id: string | null; sku: string; name: string; qty: number; price: number | null; per_lb: number | null; image: string | null }[];
};

/** One past order with "Order again" (puts the same items back in the cart). */
export function POrderCard({ o }: { o: POrderView }) {
  const { add, t, lang } = usePartner();
  const [done, setDone] = useState(false);
  const day = new Date(o.at).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="ptn-order">
      <div className="ptn-order-h">
        <span><b>{o.no}</b><span className="adc-muted small">{day}{o.po ? ` · PO ${o.po}` : ""}</span></span>
        <span className={`ptn-st ${o.status}`}>{t.status[o.status] ?? o.status}</span>
      </div>
      <div className="ptn-order-ls">
        {o.lines.map((l, i) => (
          <span key={i} className="ptn-order-l">
            <span className="ptn-line-ph xs"><PImg src={l.image} alt="" /></span>
            <span className="ellipsis">{l.qty} × {l.name}</span>
            <b>{l.price === null ? (l.per_lb ? t.perLb(usd(l.per_lb)) : t.tbd) : usd(l.price * l.qty)}</b>
          </span>
        ))}
      </div>
      <div className="ptn-order-f">
        <span className="adc-muted small">{o.tracking ? t.tracking(o.tracking) : o.status === "new" ? t.gettingReady : ""}</span>
        <b>{usd(o.subtotal)}{o.has_quote ? " +" : ""}</b>
        {o.status !== "cancelled" ? (
          <button
            type="button"
            className={`adc-add${done ? " done" : ""}`}
            onClick={() => {
              o.lines.forEach((l) => add({ id: l.item_id, sku: l.sku, name: l.name, image: l.image }, l.qty));
              setDone(true);
            }}
          >
            {done ? <><CircleCheck size={16} /> {t.inYourCart}</> : <><RotateCcw size={16} /> {t.orderAgain}</>}
          </button>
        ) : null}
      </div>
    </div>
  );
}
