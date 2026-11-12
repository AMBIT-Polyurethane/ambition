"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, CircleAlert, Plus, Repeat, Trash2, Undo2 } from "lucide-react";
import { ItemPick, type StockItem } from "@/components/incoming-forms";
import { CustomerPicker } from "@/components/customer-picker";
import { unpackCustomer, type PackedCustomer } from "@/lib/customers";
import { money } from "@/lib/format";
import { createReturn, type BackLine } from "@/app/(app)/orders/return-actions";
import type { Branch } from "@/lib/types";

export type Price = { price: number | null; account: boolean };
type Back = { key: number; item: StockItem | null; qty: string; lot_no: string; mfg: string; exp: string; condition: "stock" | "damaged"; credit: string; note: string };
type Out = { key: number; item: StockItem | null; qty: string };

/** Staff: a return or an exchange. What comes back (lot and expiration for foam and lot-tracked items), and for an exchange, what goes out. */
export function ReturnForm({
  branches, branch: startBranch, items, prices, paid, companies, original, start,
}: {
  branches: { id: string; name: string }[];
  branch: string;
  /** Each location's items (from its COUNT SHEET), with which ones are counted by lot. */
  items: Record<string, StockItem[]>;
  prices: Record<string, Price>;
  /** What the customer paid for each item on the original order (the credit starts there). */
  paid: Record<string, number>;
  companies: PackedCustomer[];
  original: { id: string; label: string; company: string; lines: { product_id: string; sku: string; name: string; qty: number; unit: string }[] } | null;
  start: "return" | "exchange";
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"return" | "exchange">(start);
  const [branch, setBranch] = useState(startBranch);
  const [customers, setCustomers] = useState(() => companies.map(unpackCustomer));
  const [company, setCompany] = useState(original?.company ?? "");
  const [reason, setReason] = useState("");
  const [delivery, setDelivery] = useState<"pickup" | "jobsite">("pickup");
  const [address, setAddress] = useState("");
  const here = items[branch] ?? [];
  const byId = useMemo(() => new Map(here.map((i) => [i.product_id, i])), [here]);
  const credit0 = (id: string) => (paid[id] !== undefined ? String(paid[id]) : prices[id]?.price ? String(prices[id].price) : "");
  const blankBack = (k: number): Back => ({ key: k, item: null, qty: "", lot_no: "", mfg: "", exp: "", condition: "stock", credit: "", note: "" });
  const [back, setBack] = useState<Back[]>([blankBack(0)]);
  const [out, setOut] = useState<Out[]>([{ key: 0, item: null, qty: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();

  const setB = (k: number, p: Partial<Back>) => setBack((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const setO = (k: number, p: Partial<Out>) => setOut((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const lotted = (i: StockItem | null) => Boolean(i && (i.lots || i.track));
  const creditTotal = back.reduce((s, r) => s + (r.item && Number(r.qty) > 0 && r.credit.trim() ? Number(r.credit) * Number(r.qty) : 0), 0);
  const outKnown = out.every((r) => !r.item || !(Number(r.qty) > 0) || (prices[r.item.product_id]?.price ?? null) !== null);
  const outTotal = out.reduce((s, r) => s + (r.item && Number(r.qty) > 0 ? (prices[r.item.product_id]?.price ?? 0) * Number(r.qty) : 0), 0);

  const addFromOrder = (l: { product_id: string; qty: number }) => {
    const i = byId.get(l.product_id);
    if (!i) return;
    setBack((rs) => [...rs.filter((r) => r.item), { ...blankBack(Date.now()), item: i, qty: "1", credit: credit0(i.product_id) }]);
  };

  const submit = () =>
    go(async () => {
      setError(null);
      const res = await createReturn({
        kind,
        branch,
        companyId: company,
        original: original?.id ?? null,
        reason,
        delivery,
        address,
        back: back.filter((r) => r.item).map((r): BackLine => ({ product_id: r.item!.product_id, qty: Number(r.qty), lot_no: r.lot_no, mfg: r.mfg, exp: r.exp, condition: r.condition, unit_credit: r.credit, note: r.note })),
        out: kind === "exchange" ? out.filter((r) => r.item).map((r) => ({ product_id: r.item!.product_id, qty: Number(r.qty) })) : [],
      });
      if (!res.ok) return setError(res.error);
      router.push(`/orders/${res.id}?msg=${encodeURIComponent(kind === "exchange" ? "Exchange saved. The replacement goes through the order desk like any order; receive the returned items when they come back." : "Return saved. Receive the items when they come back.")}`);
    });

  const missingLot = back.some((r) => r.item && r.item.lots && r.condition === "stock" && !r.lot_no.trim());
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="seg big" role="radiogroup" aria-label="Return or exchange">
        <button type="button" role="radio" aria-checked={kind === "exchange"} className={kind === "exchange" ? "on" : ""} onClick={() => setKind("exchange")}><Repeat size={16} /> Exchange</button>
        <button type="button" role="radio" aria-checked={kind === "return"} className={kind === "return" ? "on" : ""} onClick={() => setKind("return")}><Undo2 size={16} /> Return</button>
      </div>

      <section className="card col" style={{ gap: 10 }}>
        {original ? (
          <div className="field"><span className="label">From order</span><b>{original.label}</b></div>
        ) : (
          <div className="field">
            <span className="label">Customer</span>
            <CustomerPicker
              customers={customers}
              value={company}
              onChange={setCompany}
              onAdded={(c) => setCustomers((l) => [...l, c])}
              branches={branches.map((b) => ({ id: b.id, name: b.name } as Branch))}
              canAdd={false}
            />
          </div>
        )}
        <label className="field">
          <span className="label">Location it comes back to{kind === "exchange" ? " (and the new items go out from)" : ""}</span>
          <select className="select" value={branch} onChange={(e) => (setBranch(e.target.value), setBack([blankBack(Date.now())]), setOut([{ key: Date.now(), item: null, qty: "" }]))}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Reason</span>
          <input className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Swapping one Open Cell drum for HFO; wrong item; damaged in transit…" />
        </label>
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}><ArrowDownLeft size={18} className="red" /><b>Coming back</b></div>
        {original?.lines.length ? (
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="tiny muted">From {original.label.split(" · ")[0]}:</span>
            {original.lines.filter((l) => byId.has(l.product_id)).map((l) => (
              <button key={l.product_id} type="button" className="chip sm" onClick={() => addFromOrder(l)}>+ {l.sku}</button>
            ))}
          </div>
        ) : null}
        {back.map((r) => (
          <div key={r.key} className="ret-line">
            <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <ItemPick items={here} value={r.item} onPick={(i) => setB(r.key, { item: i, credit: r.credit || credit0(i.product_id) })} />
              </div>
              <button type="button" className="iconbtn sm" aria-label="Remove" onClick={() => setBack((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankBack(Date.now())]))}><Trash2 size={15} /></button>
            </div>
            {r.item ? (
              <>
                <div className="ret-grid">
                  <label className="field"><span className="label">How many ({r.item.unit})</span><input className="input sm" inputMode="decimal" value={r.qty} onChange={(e) => setB(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} /></label>
                  <label className="field">
                    <span className="label">Condition</span>
                    <select className="select sm" value={r.condition} onChange={(e) => setB(r.key, { condition: e.target.value as Back["condition"] })}>
                      <option value="stock">Good: back into stock</option>
                      <option value="damaged">Damaged: don&apos;t stock it</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Credit each{prices[r.item.product_id]?.account && paid[r.item.product_id] === undefined ? " (account priced)" : ""}</span>
                    <input className="input sm" inputMode="decimal" value={r.credit} onChange={(e) => setB(r.key, { credit: e.target.value.replace(/[^\d.]/g, "") })} placeholder="$" />
                  </label>
                </div>
                {lotted(r.item) ? (
                  <div className="ret-grid">
                    <label className="field"><span className="label">Lot / Batch #{r.item.lots ? " (required)" : ""}</span><input className="input sm" value={r.lot_no} maxLength={60} onChange={(e) => setB(r.key, { lot_no: e.target.value })} placeholder="From the drum label" /></label>
                    <label className="field"><span className="label">Mfg date</span><input className="input sm" type="date" value={r.mfg} onChange={(e) => setB(r.key, { mfg: e.target.value })} /></label>
                    <label className="field"><span className="label">Exp date</span><input className="input sm" type="date" value={r.exp} onChange={(e) => setB(r.key, { exp: e.target.value })} /></label>
                  </div>
                ) : null}
                <input className="input sm" value={r.note} maxLength={300} onChange={(e) => setB(r.key, { note: e.target.value })} placeholder="Note (optional): seal intact, half used…" aria-label="Note" />
              </>
            ) : null}
          </div>
        ))}
        <button type="button" className="linkbtn small" style={{ alignSelf: "flex-start" }} onClick={() => setBack((rs) => [...rs, blankBack(Date.now())])}><Plus size={14} /> Add another item coming back</button>
      </section>

      {kind === "exchange" ? (
        <section className="card col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}><ArrowUpRight size={18} className="red" /><b>Going out in exchange</b></div>
          {out.map((r) => (
            <div key={r.key} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <div className="grow" style={{ minWidth: 0 }}><ItemPick items={here} value={r.item} onPick={(i) => setO(r.key, { item: i, qty: r.qty || "1" })} /></div>
              <input className="input sm" style={{ width: 76, textAlign: "right" }} inputMode="decimal" value={r.qty} placeholder="Qty" aria-label="How many" onChange={(e) => setO(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} />
              <button type="button" className="iconbtn sm" aria-label="Remove" onClick={() => setOut((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: Date.now(), item: null, qty: "" }]))}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="linkbtn small" style={{ alignSelf: "flex-start" }} onClick={() => setOut((rs) => [...rs, { key: Date.now(), item: null, qty: "" }])}><Plus size={14} /> Add another item going out</button>
          <div className="seg" role="radiogroup" aria-label="Delivery">
            <button type="button" className={delivery === "pickup" ? "on" : ""} onClick={() => setDelivery("pickup")}>Customer picks up</button>
            <button type="button" className={delivery === "jobsite" ? "on" : ""} onClick={() => setDelivery("jobsite")}>AMBIT delivers</button>
          </div>
          {delivery === "jobsite" ? <textarea className="textarea" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address" aria-label="Delivery address" /> : null}
        </section>
      ) : null}

      <section className="card col ret-sum" style={{ gap: 6 }}>
        <div className="row between"><span className="muted small">Credit for what comes back</span><b>{creditTotal ? money(creditTotal) : "–"}</b></div>
        {kind === "exchange" ? (
          <>
            <div className="row between"><span className="muted small">New items (list price)</span><b>{outKnown ? money(outTotal) : "Account pricing"}</b></div>
            <div className="row between"><span className="small"><b>Customer pays the difference</b></span><b className="red">{outKnown && creditTotal ? money(Math.max(0, outTotal - creditTotal)) : "Set at the Sales Order # step"}</b></div>
          </>
        ) : null}
        <span className="tiny faint">The order desk enters the final prices (and the credit memo) at the Sales Order # step, like any order.</span>
      </section>

      {missingLot ? <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none" }} /><span>Spray foam goes back into stock by lot: type the lot # from each drum&apos;s label.</span></div> : null}
      {error ? <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div> : null}
      <button type="button" className="btn block" disabled={pending || !company || missingLot || !back.some((r) => r.item && Number(r.qty) > 0)} onClick={submit}>
        {pending ? "Saving…" : kind === "exchange" ? "Save the exchange" : "Save the return"}
      </button>
    </div>
  );
}
