"use client";

import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle, Minus, Plus } from "lucide-react";
import { rebuildLoaded } from "@/app/(app)/orders/actions";
import { dateShort, plural } from "@/lib/format";

// Admins, on a picked-up or shipped order: rebuild what went out. For each spray foam item, how many drums came off
// each lot (another brand or Summer / Winter too). Everything saves together; FOAM LOTS and the order follow (0073).

export type FixLot = {
  lot_id: number;
  sku: string;
  name: string;
  lot_no: string | null;
  exp: string | null;
  use_by: string | null;
  remaining: number;
  mine: number;
  on_sheet: boolean;
  same_type: boolean;
  expired: boolean;
  held_for: string | null;
};
export type FixItem = { item: number; name: string; sku: string; unit: string; total: number; noLot: number; options: FixLot[] };

const q2 = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const num = (s: string | undefined) => {
  const t = (s ?? "").trim();
  if (!t) return 0;
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
};

export function LoadedFix({ orderId, items, back }: { orderId: string; items: FixItem[]; back?: string }) {
  const start = useMemo(() => Object.fromEntries(items.map((it) => [it.item, Object.fromEntries(it.options.map((o) => [o.lot_id, o.mine ? q2(o.mine) : ""]))])), [items]);
  const [qty, setQty] = useState<Record<number, Record<number, string>>>(start);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (item: number, lot: number, v: string) => {
    setError(null);
    setQty((p) => ({ ...p, [item]: { ...p[item], [lot]: v.replace(/[^\d.]/g, "") } }));
  };
  const step = (item: number, lot: number, d: number) => set(item, lot, q2(Math.max(0, (num(qty[item]?.[lot]) || 0) + d)));
  const sumOf = (it: FixItem) => it.options.reduce((t, o) => t + (num(qty[it.item]?.[o.lot_id]) || 0), 0);
  const changed = (it: FixItem) => it.noLot > 0 || it.options.some((o) => (num(qty[it.item]?.[o.lot_id]) || 0) !== o.mine);
  const bad = items.find((it) => it.options.some((o) => Number.isNaN(num(qty[it.item]?.[o.lot_id]))));
  const off = items.filter((it) => changed(it) && Math.abs(sumOf(it) - it.total) > 0.001);
  const todo = items.filter(changed);

  const save = async () => {
    setError(null);
    if (bad) return setError(`Check the numbers for ${bad.name} (whole drums, or blank for none).`);
    if (!todo.length) return setError("Nothing changed yet.");
    if (off.length) return setError(`${off[0].name}: the lots add up to ${q2(sumOf(off[0]))}, but ${q2(off[0].total)} went out.`);
    if (reason.trim().length < 3) return setError("Say why it's changing (for example: packing slip shows all 22 from LW7991).");
    setBusy(true);
    const res = await rebuildLoaded({
      id: orderId,
      back,
      reason: reason.trim(),
      items: todo.map((it) => ({ item: it.item, lots: it.options.map((o) => ({ lot: o.lot_id, qty: num(qty[it.item]?.[o.lot_id]) || 0 })).filter((x) => x.qty > 0) })),
    });
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  };

  const row = (it: FixItem, o: FixLot) => {
    const v = qty[it.item]?.[o.lot_id] ?? "";
    const max = o.remaining + o.mine;
    const n = num(v) || 0;
    return (
      <div key={o.lot_id} className={`lf-row${n ? " on" : ""}`}>
        <div className="col tight" style={{ minWidth: 0 }}>
          <span className="small">
            {o.same_type ? null : <b>{o.sku} · </b>}Lot <b>{o.lot_no || "(no lot #)"}</b>
            {o.exp ? <span className="faint"> · exp {dateShort(o.exp)}</span> : o.use_by ? <span className="faint"> · use by {dateShort(o.use_by)}</span> : null}
          </span>
          <span className="tiny faint">
            {o.mine ? `${q2(o.mine)} recorded now · ` : ""}
            {o.on_sheet ? `${q2(Math.max(0, max))} could have come from it` : "not on FOAM LOTS any more"}
            {o.expired ? " · EXPIRED" : ""}
            {o.held_for ? <span className="warn-t"> · HELD for {o.held_for}</span> : null}
          </span>
        </div>
        <div className="row nowrap" style={{ gap: 4 }}>
          <button type="button" className="iconbtn sm" onClick={() => step(it.item, o.lot_id, -1)} aria-label={`One less from lot ${o.lot_no}`}><Minus size={15} /></button>
          <input
            className={`input sm lf-qty${n > max + 0.001 ? " over" : ""}`}
            inputMode="decimal"
            value={v}
            placeholder="0"
            onChange={(e) => set(it.item, o.lot_id, e.target.value)}
            aria-label={`${it.name} from lot ${o.lot_no ?? ""}`}
          />
          <button type="button" className="iconbtn sm" onClick={() => step(it.item, o.lot_id, 1)} aria-label={`One more from lot ${o.lot_no}`}><Plus size={15} /></button>
        </div>
      </div>
    );
  };

  return (
    <details className="card lotfix" open={false}>
      <summary><b>Fix what went out</b> <span className="tiny faint">· admins: drums from each lot, the way the packing slip shows it</span></summary>
      <p className="tiny faint" style={{ margin: "6px 0 4px" }}>
        Type how many {items.every((i) => i.unit === items[0]?.unit) ? plural(items[0]?.unit ?? "drum", 2) : "drums"} came off each lot, the way the packing slip shows it.
        Saving puts back what the app had recorded and takes off what you enter (Shipped Out on FOAM LOTS, so the COUNT SHEET follows), and the
        order&apos;s lot record and PENDING ORDERS are corrected. Prices and the invoice don&apos;t change. To change how many went out, use Edit order.
      </p>
      {items.map((it) => {
        const total = sumOf(it);
        const ok = Math.abs(total - it.total) < 0.001;
        const same = it.options.filter((o) => o.same_type);
        const other = it.options.filter((o) => !o.same_type);
        return (
          <section key={it.item} className="lf-item">
            <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
              <div className="col tight" style={{ minWidth: 0 }}>
                <b>{it.name}</b>
                <span className="tiny faint">{it.sku}{it.noLot ? ` · ${q2(it.noLot)} had no lot recorded: put them on their lot` : ""}</span>
              </div>
              <span className={`pill ${ok ? "ok" : "red"} nowrap`}>
                {ok ? <CircleCheck size={13} /> : <CircleAlert size={13} />} {q2(total)} of {q2(it.total)} {plural(it.unit, it.total)}
              </span>
            </div>
            {same.map((o) => row(it, o))}
            {other.length ? (
              <details className="lf-other" open={other.some((o) => o.mine > 0)}>
                <summary className="tiny">A different product went out ({other.length} {other.length === 1 ? "lot" : "lots"})</summary>
                {other.map((o) => row(it, o))}
              </details>
            ) : null}
          </section>
        );
      })}
      <label className="field">
        <span className="label">Why (shows on the item variance table)</span>
        <input className="input sm" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Packing slip shows all 22 Winter 5.0 from LW7991" />
      </label>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="button" className="btn" onClick={save} disabled={busy || !todo.length} style={{ gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} Save what went out
      </button>
    </details>
  );
}
