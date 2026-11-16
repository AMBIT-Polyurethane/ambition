"use client";

import { useMemo, useState } from "react";
import { CircleAlert, LoaderCircle, Minus, Plus, Trash2, Undo2 } from "lucide-react";
import { ItemPick, type StockItem } from "@/components/incoming-forms";
import { editOrder } from "@/app/(app)/orders/actions";
import { changeText, type OrderChange } from "@/lib/order-edit";
import { dateShort, plural } from "@/lib/format";

// Edit order (AMBIT staff): change or remove quantities and add items, then Save. The page says what happens next.

export type EditItem = { id: number; product_id: string | null; sku: string; name: string; unit: string; qty: number; locked?: string | null };
export type AddChoice = { product_id: string; sku: string; name: string; unit: string; available?: number | null; lots?: boolean };
/** A lot a spray foam item could have come from, at the order's location (0070). */
export type LotChoice = { lot_id: number; product_id: string; sku: string; name: string; lot_no: string | null; exp: string | null; use_by: string | null; remaining: number; available: number; expired: boolean; same_type: boolean };

type Row = { key: string; id: number | null; product_id: string | null; sku: string; name: string; unit: string; was: number; qty: string; locked?: string | null; lot: string };

const lotText = (o: LotChoice) =>
  [o.sku, `Lot ${o.lot_no || "(no lot #)"}`, o.exp ? `exp ${dateShort(o.exp)}` : o.use_by ? `use by ${dateShort(o.use_by)}` : null, `${Math.max(0, o.remaining)} left`, o.expired ? "EXPIRED" : null]
    .filter(Boolean)
    .join(" · ");

const num = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Number(s) : null);

export function OrderEditor({
  orderId,
  items,
  choices,
  next,
  closed = false,
  lotChoices = {},
}: {
  orderId: string;
  items: EditItem[];
  choices: AddChoice[];
  next: string;
  closed?: boolean;
  lotChoices?: Record<string, LotChoice[]>;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((i) => ({ key: `i${i.id}`, id: i.id, product_id: i.product_id, sku: i.sku, name: i.name, unit: i.unit, was: Number(i.qty), qty: String(Number(i.qty)), locked: i.locked, lot: "" })),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<StockItem | null>(null);

  const onOrder = new Set(rows.map((r) => r.product_id).filter(Boolean));
  const pickList: StockItem[] = useMemo(
    () => choices.filter((c) => !onOrder.has(c.product_id)).map((c) => ({ product_id: c.product_id, sku: c.sku, name: c.name, unit: c.unit, lots: !!c.lots })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choices, rows.length],
  );
  const set = (key: string, qty: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, qty } : r)));
  const setLot = (key: string, lot: string) => {
    setError(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, lot } : r)));
  };
  // A completed order: spray foam that's added or changed says which lot really went out.
  const lotsFor = (r: Row) => (closed && r.product_id ? lotChoices[r.product_id] ?? [] : []);
  const needLot = (r: Row) => {
    const q = num(r.qty);
    return lotsFor(r).length > 0 && q !== null && q > 0 && (r.id === null || q !== r.was);
  };
  const lotOf = (r: Row) => lotsFor(r).find((o) => String(o.lot_id) === r.lot);
  const step = (r: Row, d: number) => set(r.key, String(Math.max(0, (num(r.qty) ?? 0) + d)));

  const changes: OrderChange[] = rows
    .map((r) => ({ sku: r.sku, name: r.name, unit: r.unit, from: r.was, to: num(r.qty) ?? NaN }))
    .filter((c) => Number.isFinite(c.to) && c.to !== c.from);
  const bad = rows.find((r) => num(r.qty) === null);
  const left = rows.filter((r) => (num(r.qty) ?? 0) > 0).length;

  const add = (it: StockItem) => {
    setRows((rs) => [...rs, { key: `n${it.product_id}`, id: null, product_id: it.product_id, sku: it.sku, name: it.name, unit: it.unit, was: 0, qty: "1", lot: "" }]);
    setPicking(null);
  };

  const save = async () => {
    setError(null);
    if (bad) return setError(`Check the quantity for ${bad.sku} (a number, 0 to take it off).`);
    if (!changes.length) return setError("Nothing changed yet.");
    if (!left) return setError("An order needs at least one item. To drop everything, cancel the order instead.");
    const noLot = rows.find((r) => needLot(r) && !r.lot);
    if (noLot) return setError(`Pick the lot that went out for ${noLot.sku}.`);
    setBusy(true);
    const res = await editOrder({
      id: orderId,
      lines: rows
        .filter((r) => r.id !== null || (num(r.qty) ?? 0) > 0)
        .map((r) => {
          const lot_id = needLot(r) && r.lot ? Number(r.lot) : null;
          return r.id !== null ? { id: r.id, qty: num(r.qty) ?? 0, lot_id } : { product_id: r.product_id, qty: num(r.qty) ?? 0, lot_id };
        }),
      note,
    });
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="list">
        {rows.map((r) => {
          const q = num(r.qty);
          const removed = q === 0;
          const changed = q !== null && q !== r.was;
          return (
            <div key={r.key} className={`item edit-row${removed ? " removed" : ""}`} style={{ alignItems: "center", gap: 10 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t ellipsis">{r.name}</div>
                <div className="s">
                  {r.sku}
                  {r.id === null ? <span className="pill sm" style={{ marginLeft: 6 }}>New</span> : changed ? <span className="tiny faint"> · was {r.was} {plural(r.unit, r.was)}</span> : null}
                </div>
                {r.locked ? <div className="tiny warn-t">{r.locked}</div> : null}
                {needLot(r) ? (
                  <select
                    className="select sm edit-lot"
                    value={r.lot}
                    onChange={(e) => setLot(r.key, e.target.value)}
                    aria-label={`Lot that went out for ${r.sku}`}
                  >
                    <option value="">Which lot went out?</option>
                    {lotsFor(r).some((o) => o.same_type) ? (
                      <optgroup label="Same product">
                        {lotsFor(r).filter((o) => o.same_type).map((o) => <option key={o.lot_id} value={o.lot_id}>{lotText(o)}</option>)}
                      </optgroup>
                    ) : null}
                    {lotsFor(r).some((o) => !o.same_type) ? (
                      <optgroup label="A different product went out">
                        {lotsFor(r).filter((o) => !o.same_type).map((o) => <option key={o.lot_id} value={o.lot_id}>{lotText(o)}</option>)}
                      </optgroup>
                    ) : null}
                  </select>
                ) : null}
              </div>
              {r.locked ? (
                <b className="small nowrap">{r.was} {plural(r.unit, r.was)}</b>
              ) : removed && r.id !== null ? (
                <button type="button" className="btn sm ghost" onClick={() => set(r.key, String(r.was))}><Undo2 size={15} /> Undo</button>
              ) : (
                <div className="row nowrap" style={{ gap: 4 }}>
                  <button type="button" className="iconbtn" aria-label={`One less ${r.sku}`} onClick={() => step(r, -1)}><Minus size={16} /></button>
                  <input className="input sm qty-in" inputMode="decimal" value={r.qty} onChange={(e) => set(r.key, e.target.value)} aria-label={`Quantity of ${r.sku}`} style={{ width: 70, textAlign: "center" }} />
                  <button type="button" className="iconbtn" aria-label={`One more ${r.sku}`} onClick={() => step(r, 1)}><Plus size={16} /></button>
                  <span className="tiny faint" style={{ minWidth: 34 }}>{plural(r.unit, num(r.qty) ?? 2)}</span>
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Take ${r.sku} off the order`}
                    onClick={() => (r.id === null ? setRows((rs) => rs.filter((x) => x.key !== r.key)) : set(r.key, "0"))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <section className="card col" style={{ gap: 8 }}>
        <b className="small">Add an item</b>
        <ItemPick items={pickList} value={picking} onPick={add} />
        <span className="tiny faint">Only items this location carries. Type part of the SKU or name.</span>
      </section>

      <label className="field">
        <span className="label">Why (optional, shows in the order history)</span>
        <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Customer called to add 4 drums" />
      </label>

      {changes.length ? (
        <section className="card col" style={{ gap: 4 }}>
          <b className="small">What changes</b>
          <ul className="edit-changes small">
            {changes.map((c) => <li key={c.sku}>{changeText(c)}</li>)}
            {rows
              .filter((r) => needLot(r) && lotOf(r))
              .map((r) => {
                const o = lotOf(r)!;
                return <li key={`lot${r.key}`}>{r.name}: from {o.sku.toUpperCase() === r.sku.toUpperCase() ? "" : `${o.sku} `}lot {o.lot_no || "(no lot #)"}</li>;
              })}
          </ul>
        </section>
      ) : null}
      <div className="alert info small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{next}</span></div>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="button" className="btn" onClick={save} disabled={busy || !changes.length} style={{ gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} Save changes
      </button>
    </div>
  );
}
