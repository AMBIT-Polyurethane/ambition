"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Mail, MapPin, Phone, Truck, Undo2, X } from "lucide-react";
import { setOrderStatus } from "@/app/store/desk-actions";

export type DeskOrder = {
  id: number;
  no: string;
  at: string;
  status: "new" | "shipped" | "done" | "cancelled";
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  account: string | null;
  delivery: "ship" | "pickup";
  address: { street?: string; city?: string; state?: string; zip?: string } | null;
  po: string | null;
  notes: string | null;
  tracking: string | null;
  subtotal: number;
  has_quote: boolean;
  lang: string;
  lines: { sku: string; name: string; unit: string | null; qty: number; price: number | null; per_lb: number | null }[];
};

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const LABEL = { new: "New", shipped: "Shipped", done: "Done", cancelled: "Cancelled" } as const;

export function DeskOrders({ slug, orders: start, readOnly }: { slug: string; orders: DeskOrder[]; readOnly: boolean }) {
  const [orders, setOrders] = useState(start);
  const [f, setF] = useState<"open" | DeskOrder["status"] | "all">("open");
  const [open, setOpen] = useState<number | null>(start.find((o) => o.status === "new")?.id ?? null);
  const shown = orders.filter((o) => (f === "all" ? true : f === "open" ? o.status === "new" || o.status === "shipped" : o.status === f));
  const count = (s: DeskOrder["status"]) => orders.filter((o) => o.status === s).length;
  return (
    <div className="adc-stack-s">
      <div className="ptn-desk-h">
        <span>
          <h1 className="adc-h1">Orders</h1>
          <span className="adc-muted">Every order from your store. Each one is also emailed to you. Confirm the total, then send the invoice.</span>
        </span>
      </div>
      <div className="adc-chips">
        {([
          ["open", `Open (${count("new") + count("shipped")})`],
          ["new", `New (${count("new")})`],
          ["shipped", `Shipped (${count("shipped")})`],
          ["done", `Done (${count("done")})`],
          ["cancelled", `Cancelled (${count("cancelled")})`],
          ["all", `All (${orders.length})`],
        ] as [typeof f, string][]).map(([k, l]) => (
          <button key={k} type="button" className={f === k ? "on" : undefined} onClick={() => setF(k)}>{l}</button>
        ))}
      </div>
      {shown.length ? (
        <div className="ptn-orders">
          {shown.map((o) => (
            <OrderCard
              key={o.id}
              slug={slug}
              o={o}
              open={open === o.id}
              readOnly={readOnly}
              onToggle={() => setOpen(open === o.id ? null : o.id)}
              onChange={(p) => setOrders((cur) => cur.map((x) => (x.id === o.id ? { ...x, ...p } : x)))}
            />
          ))}
        </div>
      ) : (
        <div className="adc-empty"><Truck size={28} aria-hidden="true" /><b>No orders here.</b><span>New orders from your store show up here and in your email.</span></div>
      )}
    </div>
  );
}

function OrderCard({ slug, o, open, readOnly, onToggle, onChange }: { slug: string; o: DeskOrder; open: boolean; readOnly: boolean; onToggle: () => void; onChange: (p: Partial<DeskOrder>) => void }) {
  const [tracking, setTracking] = useState(o.tracking ?? "");
  const [notify, setNotify] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const when = new Date(o.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const go = (status: DeskOrder["status"]) =>
    start(async () => {
      setErr(null);
      const r = await setOrderStatus(slug, o.id, status, tracking, status === "shipped" && notify);
      if (!r.ok) return setErr(r.error);
      onChange({ status, tracking: tracking.trim() || null });
      setNote(r.message ?? null);
    });
  const a = o.address;
  return (
    <div className={`ptn-order${o.account?.startsWith("AMBIT") ? " ambit" : ""}`}>
      <button type="button" className="ptn-order-h ptn-order-tog" onClick={onToggle} aria-expanded={open}>
        <span>
          <b>{o.no} · {o.company || o.name}</b>
          <span className="adc-muted small">{when} · {o.lines.length} {o.lines.length === 1 ? "line" : "lines"} · {usd(o.subtotal)}{o.has_quote ? " + to confirm" : ""}{o.account ? " · signed-in customer" : " · guest"}{o.lang === "es" ? " · Spanish" : ""}</span>
        </span>
        <span className={`ptn-st ${o.status}`}>{LABEL[o.status]}</span>
        <ChevronDown size={18} aria-hidden="true" className={open ? "flip" : undefined} />
      </button>
      {open ? (
        <>
          <div className="ptn-order-who">
            <span><b>{o.name}</b>{o.company ? <span>{o.company}</span> : null}<a href={`mailto:${o.email}`}><Mail size={14} aria-hidden="true" /> {o.email}</a>{o.phone ? <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}><Phone size={14} aria-hidden="true" /> {o.phone}</a> : null}</span>
            <span><MapPin size={15} aria-hidden="true" /> {o.delivery === "pickup" ? "Picking up" : [a?.street, [a?.city, a?.state].filter(Boolean).join(", "), a?.zip].filter(Boolean).join(" · ") || "No address"}</span>
            {o.po ? <span><b>PO</b> {o.po}</span> : null}
          </div>
          <div className="ptn-order-ls">
            {o.lines.map((l, i) => (
              <span key={i} className="ptn-order-l2">
                <span className="adc-sku">{l.sku}</span>
                <span className="ellipsis">{l.qty} × {l.name}</span>
                <span className="num">{l.price !== null ? `${usd(l.price)} ea` : l.per_lb ? `${usd(l.per_lb)}/lb` : "to confirm"}</span>
                <b className="num">{l.price === null ? "-" : usd(l.price * l.qty)}</b>
              </span>
            ))}
          </div>
          {o.notes ? <p className="ptn-order-note"><b>Notes:</b> {o.notes}</p> : null}
          {!readOnly ? (
            <div className="ptn-order-f">
              {o.status === "new" ? (
                <>
                  <span className="ptn-ship">
                    <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number (optional)" aria-label="Tracking number" />
                    <label className="ptn-toggle small"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the customer</label>
                  </span>
                  <button type="button" className="adc-add" disabled={pending} onClick={() => go("shipped")}><Truck size={16} /> Shipped / picked up</button>
                  <button type="button" className="ptn-icon wide" disabled={pending} onClick={() => go("cancelled")}><X size={14} /> Cancel order</button>
                </>
              ) : o.status === "shipped" ? (
                <>
                  <span className="adc-muted small">{o.tracking ? `Tracking ${o.tracking}` : "Shipped"}</span>
                  <button type="button" className="adc-add" disabled={pending} onClick={() => go("done")}><Check size={16} /> Done (delivered and invoiced)</button>
                  <button type="button" className="ptn-icon wide" disabled={pending} onClick={() => go("new")}><Undo2 size={14} /> Back to new</button>
                </>
              ) : (
                <>
                  <span className="adc-muted small">{o.status === "done" ? "Finished." : "Cancelled."}</span>
                  <button type="button" className="ptn-icon wide" disabled={pending} onClick={() => go("new")}><Undo2 size={14} /> Reopen</button>
                </>
              )}
              {pending ? <LoaderCircle size={18} className="spin" /> : null}
            </div>
          ) : null}
          {err ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {err}</div> : null}
          {note ? <div className="ptn-ok" role="status"><Check size={18} aria-hidden="true" /><span>{note}</span></div> : null}
        </>
      ) : null}
    </div>
  );
}
