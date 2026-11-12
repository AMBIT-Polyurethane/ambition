"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleCheck, LoaderCircle, Plus, Search, Truck, X } from "lucide-react";
import { dateShort } from "@/lib/format";
import { buyableItems, type BuyItem } from "@/app/(app)/expenses/actions";

// Inventory bought on a receipt (0062): which warehouse it's for, what was bought, and whether the buyer has it
// (a Receiving Report for an admin to approve) or it's being shipped (an expected delivery for the warehouse).

export type BuyLine = { id: string; sku: string; name: string; unit: string; lot: boolean; qty: string; lot_no: string };
export type BuyState = { branch: string; mode: "picked_up" | "shipped" | ""; expected: string; lines: BuyLine[] };
/** The report already made from this receipt, when editing it. */
export type BuyDone = { id: number; status: string; branch: string; expected: string } | null;

export function BuyInventory({
  warehouses,
  value,
  onChange,
  done,
  today,
}: {
  warehouses: { id: string; name: string }[];
  value: BuyState;
  onChange: (v: BuyState) => void;
  done: BuyDone;
  today: string;
}) {
  const [items, setItems] = useState<BuyItem[] | null>(null);
  const [q, setQ] = useState("");
  const set = (p: Partial<BuyState>) => onChange({ ...value, ...p });

  useEffect(() => {
    let on = true;
    setItems(null);
    if (!value.branch) return;
    buyableItems(value.branch).then((list) => on && setItems(list)).catch(() => on && setItems([]));
    return () => {
      on = false;
    };
  }, [value.branch]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || !items) return [];
    const have = new Set(value.lines.map((l) => l.id));
    return items
      .filter((i) => !have.has(i.id) && words.every((w) => `${i.sku} ${i.name}`.toLowerCase().includes(w)))
      .slice(0, 8);
  }, [items, q, value.lines]);

  const where = warehouses.find((w) => w.id === (done?.branch ?? value.branch))?.name ?? "the warehouse";
  if (done && done.status === "received") {
    return (
      <div className="xr-buy card col" style={{ gap: 6 }}>
        <b className="row" style={{ gap: 8 }}><CircleCheck size={17} style={{ color: "var(--ok)" }} /> Inventory: in {where}&apos;s stock</b>
        <span className="tiny muted">Receiving Report #{done.id} was approved, so it can&apos;t be changed from the receipt. Ask an admin if something&apos;s off.</span>
      </div>
    );
  }

  return (
    <div className="xr-buy card col" style={{ gap: 14 }}>
      <div className="col" style={{ gap: 2 }}>
        <b>Inventory you bought</b>
        <span className="tiny muted">It goes on that warehouse&apos;s stock, the same way a delivery does.</span>
        {done?.status === "submitted" ? <span className="tiny warn-text">Receiving Report #{done.id} is waiting for an admin to approve it. Changes here update it.</span> : null}
        {done?.status === "expected" ? <span className="tiny muted">On {where}&apos;s expected deliveries for {dateShort(done.expected)}. Changes here update it.</span> : null}
      </div>

      <div className="field">
        <span className="label">For which warehouse</span>
        <div className="xr-cats">
          {warehouses.map((w) => (
            <button key={w.id} type="button" className={`chip sm${value.branch === w.id ? " on" : ""}`} onClick={() => set({ branch: w.id, lines: w.id === value.branch ? value.lines : [] })}>
              {w.name}
            </button>
          ))}
        </div>
      </div>

      {value.branch ? (
        <div className="field xr-custf">
          <span className="label">What you bought</span>
          {value.lines.length ? (
            <div className="xr-buy-lines">
              {value.lines.map((l, i) => (
                <div key={l.id} className="xr-buy-line">
                  <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
                    <b className="ellipsis small">{l.name}</b>
                    <span className="tiny muted">{l.sku}</span>
                  </span>
                  {l.lot ? (
                    <input
                      className="input sm"
                      style={{ width: 110 }}
                      value={l.lot_no}
                      placeholder="Lot #"
                      aria-label={`Lot number for ${l.sku}`}
                      onChange={(e) => set({ lines: value.lines.map((x, k) => (k === i ? { ...x, lot_no: e.target.value } : x)) })}
                    />
                  ) : null}
                  <input
                    className="input sm"
                    style={{ width: 74 }}
                    inputMode="decimal"
                    value={l.qty}
                    placeholder="How many"
                    aria-label={`How many ${l.sku}`}
                    onChange={(e) => set({ lines: value.lines.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/[^\d.]/g, "") } : x)) })}
                  />
                  <span className="tiny muted nowrap" style={{ width: 44 }}>{l.unit}</span>
                  <button type="button" className="iconbtn sm" aria-label={`Remove ${l.sku}`} onClick={() => set({ lines: value.lines.filter((_, k) => k !== i) })}>
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="xr-search">
            <Search size={16} />
            <input
              className="input"
              id="buy-item-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={items === null ? "Loading the items…" : value.lines.length ? "Add another item: SKU or name" : "SKU or item name"}
              autoComplete="off"
              disabled={items === null}
            />
            {items === null ? <LoaderCircle size={15} className="spin" /> : null}
          </div>
          {q.trim() && items ? (
            <div className="xr-results" role="listbox">
              {shown.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    set({ lines: [...value.lines, { id: i.id, sku: i.sku, name: i.name, unit: i.unit, lot: i.lot, qty: "", lot_no: "" }] });
                    setQ("");
                  }}
                >
                  <b className="ellipsis"><Plus size={13} /> {i.name}</b>
                  <span className="tiny muted">{i.sku} · {i.unit}</span>
                </button>
              ))}
              {!shown.length ? <span className="tiny muted" style={{ padding: "10px 12px" }}>Not on this warehouse&apos;s inventory sheet. Ask an admin to add it to the sheet first.</span> : null}
            </div>
          ) : null}
          {value.lines.some((l) => l.lot) ? <span className="tiny muted">Spray foam and other lot-tracked items: type the lot # from the drum or box.</span> : null}
        </div>
      ) : null}

      <div className="field">
        <span className="label">Do you have it?</span>
        <div className="seg">
          <button type="button" className={value.mode === "picked_up" ? "on" : ""} onClick={() => set({ mode: "picked_up" })}>
            Picked up (I have it)
          </button>
          <button type="button" className={value.mode === "shipped" ? "on" : ""} onClick={() => set({ mode: "shipped", expected: value.expected || today })}>
            <Truck size={15} /> It&apos;s being shipped
          </button>
        </div>
        {value.mode === "picked_up" ? (
          <span className="tiny muted">It becomes a Receiving Report at {where}. An admin approves it, then it&apos;s in stock and on the spreadsheet.</span>
        ) : null}
        {value.mode === "shipped" ? (
          <label className="row tiny muted" style={{ gap: 8, flexWrap: "wrap" }}>
            Should get there on
            <input className="input sm" type="date" style={{ width: 160 }} value={value.expected} min={today} onChange={(e) => set({ expected: e.target.value })} />
            <span>It goes on {where}&apos;s expected deliveries; the warehouse receives it when it arrives.</span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
