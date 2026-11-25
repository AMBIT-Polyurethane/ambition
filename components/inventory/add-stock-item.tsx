"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, CircleCheck, LoaderCircle, Search } from "lucide-react";
import { addStockItem } from "@/app/(app)/inventory/item-actions";

export type AddProduct = { id: string; sku: string; name: string; unit: string; category: string | null; vendor: string | null; lead: number | null; byLot: boolean };

const digits = (v: string) => v.replace(/[^\d.]/g, "");

/** Pick a product that isn't on this location's list yet, then its count, reorder point, Max, vendor and lead time. */
export function AddStockItem({ branch, where, products }: { branch: string; where: string; products: AddProduct[] }) {
  const router = useRouter();
  const [find, setFind] = useState("");
  const [pick, setPick] = useState<AddProduct | null>(null);
  const [v, setV] = useState({ onHand: "", rop: "", max: "", vendor: "", lead: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const t = find.trim().toLowerCase();
  const shown = products.filter((p) => !t || `${p.sku} ${p.name} ${p.category ?? ""}`.toLowerCase().includes(t)).slice(0, 60);
  const choose = (p: AddProduct) => {
    setPick(p);
    setMsg(null);
    setV({ onHand: "", rop: "", max: "", vendor: p.vendor ?? "", lead: p.lead === null ? "" : String(p.lead) });
  };
  const badMax = v.rop !== "" && v.max !== "" && Number(v.max) > 0 && Number(v.max) < Number(v.rop);
  const save = () =>
    go(async () => {
      if (!pick) return;
      setMsg(null);
      const r = await addStockItem({ branch, product: pick.id, onHand: pick.byLot ? "" : v.onHand, rop: v.rop, max: v.max, vendor: v.vendor, lead: v.lead });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      router.push(`/inventory/stock?b=${branch}&msg=${encodeURIComponent(r.msg)}`);
    });

  return (
    <section className="card2 itm-add" aria-label="Add an item">
      <label className="field">
        <span className="label">1. Which product</span>
        <span className="search" style={{ position: "relative" }}>
          <Search size={17} />
          <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a SKU or name" aria-label="Find a product" autoFocus />
        </span>
      </label>
      {products.length ? (
        <div className="itm-add-pick" role="listbox" aria-label="Products not on this list yet">
          {shown.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={pick?.id === p.id} className={pick?.id === p.id ? "on" : ""} onClick={() => choose(p)}>
              <span className="col tight" style={{ minWidth: 0, gap: 2 }}><b className="small">{p.name}</b><span className="tiny faint">{p.sku}{p.category ? ` · ${p.category}` : ""}</span></span>
              {pick?.id === p.id ? <Check size={16} /> : null}
            </button>
          ))}
          {shown.length ? null : <p className="small muted" style={{ margin: 0, padding: 14 }}>No product matches. Products are added in Admin › Products &amp; pricing.</p>}
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Every product is already on {where}&apos;s list.</p>
      )}
      {pick ? (
        <>
          <b>2. {pick.name} at {where}</b>
          <div className="itm-set-f">
            {pick.byLot ? (
              <p className="tiny faint itm-set-wide" style={{ margin: 0, gridColumn: "1 / -1" }}>
                {pick.sku} is counted by lot. Add its drums on Receiving (with their lot numbers) once it&apos;s on the list; they go onto FOAM LOTS.
              </p>
            ) : (
              <label className="field"><span className="label">How many are here now ({pick.unit})</span>
                <input className="input sm" inputMode="decimal" value={v.onHand} onChange={(e) => setV({ ...v, onHand: digits(e.target.value) })} placeholder="Blank = not counted yet" />
              </label>
            )}
            <label className="field"><span className="label">Reorder at ({pick.unit})</span>
              <input className="input sm" inputMode="decimal" value={v.rop} onChange={(e) => setV({ ...v, rop: digits(e.target.value) })} />
            </label>
            <label className="field"><span className="label">Max ({pick.unit})</span>
              <input className="input sm" inputMode="decimal" value={v.max} onChange={(e) => setV({ ...v, max: digits(e.target.value) })} />
            </label>
            <label className="field"><span className="label">Vendor</span>
              <input className="input sm" value={v.vendor} maxLength={120} onChange={(e) => setV({ ...v, vendor: e.target.value })} placeholder="Who we buy it from" />
            </label>
            <label className="field"><span className="label">Lead time (business days)</span>
              <input className="input sm" inputMode="numeric" value={v.lead} onChange={(e) => setV({ ...v, lead: e.target.value.replace(/\D/g, "") })} />
            </label>
          </div>
          {badMax ? <span className="small err-text">Max has to be at least the reorder point.</span> : null}
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn" disabled={pending || badMax} onClick={save}>
              {pending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} Add {pick.sku} to {where}
            </button>
            <span className="tiny faint">Its COUNT SHEET row follows within 2 minutes.</span>
          </div>
        </>
      ) : null}
      {msg ? (
        <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />}<span>{msg.text}</span>
        </div>
      ) : null}
    </section>
  );
}
