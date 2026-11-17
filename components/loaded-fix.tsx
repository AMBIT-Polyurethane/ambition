"use client";

import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle, Minus, Plus } from "lucide-react";
import { rebuildLoaded } from "@/app/(app)/orders/actions";
import { dateShort, plural } from "@/lib/format";

// Admins, on a picked-up or shipped order: rebuild what went out. For each item, how many came off each lot (another
// brand, Summer / Winter, or any other product at the location: 0078), or off an item counted by total on the COUNT
// SHEET. Everything saves together; FOAM LOTS, the COUNT SHEET and the order follow (0073).

/** An item counted by total at this location (from fixStockList). */
export type FixStockItem = { product_id: string; sku: string; name: string; unit: string; on_hand: number };

export type FixLot = {
  /** null: counted by total on the COUNT SHEET (0078). */
  lot_id: number | null;
  product_id: string;
  by_total?: boolean;
  same_side?: boolean;
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

/** A lot ("l12") or an item counted by total ("p<product id>"). */
const keyOf = (o: Pick<FixLot, "lot_id" | "product_id">) => (o.lot_id ? `l${o.lot_id}` : `p${o.product_id}`);

export function LoadedFix({ orderId, items, back, stock = [] }: { orderId: string; items: FixItem[]; back?: string; stock?: FixStockItem[] }) {
  const start = useMemo(() => Object.fromEntries(items.map((it) => [it.item, Object.fromEntries(it.options.map((o) => [keyOf(o), o.mine ? q2(o.mine) : ""]))])), [items]);
  const [qty, setQty] = useState<Record<number, Record<string, string>>>(start);
  // Items counted by total added from the search, per order line.
  const [added, setAdded] = useState<Record<number, FixLot[]>>({});
  const [find, setFind] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optsOf = (it: FixItem) => [...it.options, ...(added[it.item] ?? [])];
  // Drums with no lot recorded, on something counted by lot (not an item counted by total).
  const noLotOf = (it: FixItem) => Math.max(0, it.noLot - it.options.filter((o) => o.by_total).reduce((t, o) => t + o.mine, 0));
  const set = (item: number, key: string, v: string) => {
    setError(null);
    setQty((p) => ({ ...p, [item]: { ...p[item], [key]: v.replace(/[^\d.]/g, "") } }));
  };
  const step = (item: number, key: string, d: number) => set(item, key, q2(Math.max(0, (num(qty[item]?.[key]) || 0) + d)));
  const sumOf = (it: FixItem) => optsOf(it).reduce((t, o) => t + (num(qty[it.item]?.[keyOf(o)]) || 0), 0);
  const changed = (it: FixItem) => noLotOf(it) > 0 || optsOf(it).some((o) => (num(qty[it.item]?.[keyOf(o)]) || 0) !== o.mine);
  const bad = items.find((it) => optsOf(it).some((o) => Number.isNaN(num(qty[it.item]?.[keyOf(o)]))));
  const add = (it: FixItem, p: FixStockItem) => {
    if (optsOf(it).some((o) => o.by_total && o.product_id === p.product_id)) return;
    setAdded((a) => ({
      ...a,
      [it.item]: [...(a[it.item] ?? []), { lot_id: null, product_id: p.product_id, sku: p.sku, name: p.name, lot_no: null, exp: null, use_by: null, remaining: p.on_hand, mine: 0, on_sheet: true, same_type: false, expired: false, held_for: null, by_total: true }],
    }));
    setFind((f) => ({ ...f, [it.item]: "" }));
  };
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
      items: todo.map((it) => ({
        item: it.item,
        lots: optsOf(it)
          .map((o) => ({ ...(o.lot_id ? { lot: o.lot_id } : { product: o.product_id }), qty: num(qty[it.item]?.[keyOf(o)]) || 0 }))
          .filter((x) => x.qty > 0),
      })),
    });
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  };

  const row = (it: FixItem, o: FixLot) => {
    const k = keyOf(o);
    const v = qty[it.item]?.[k] ?? "";
    const max = o.remaining + o.mine;
    const n = num(v) || 0;
    const what = o.by_total ? o.sku : `lot ${o.lot_no ?? ""}`;
    return (
      <div key={k} className={`lf-row${n ? " on" : ""}`}>
        <div className="col tight" style={{ minWidth: 0 }}>
          {o.by_total ? (
            <span className="small">
              <b>{o.sku}</b> · {o.name}
            </span>
          ) : (
            <span className="small">
              {o.same_type ? null : <b>{o.sku} · </b>}Lot <b>{o.lot_no || "(no lot #)"}</b>
              {o.exp ? <span className="faint"> · exp {dateShort(o.exp)}</span> : o.use_by ? <span className="faint"> · use by {dateShort(o.use_by)}</span> : null}
            </span>
          )}
          <span className="tiny faint">
            {o.mine ? `${q2(o.mine)} recorded now · ` : ""}
            {o.by_total
              ? `counted by total on the COUNT SHEET · ${q2(o.remaining)} in stock now`
              : o.on_sheet ? `${q2(Math.max(0, max))} could have come from it` : "not on FOAM LOTS any more"}
            {o.expired ? " · EXPIRED" : ""}
            {o.held_for ? <span className="warn-t"> · HELD for {o.held_for}</span> : null}
          </span>
        </div>
        <div className="row nowrap" style={{ gap: 4 }}>
          <button type="button" className="iconbtn sm" onClick={() => step(it.item, k, -1)} aria-label={`One less from ${what}`}><Minus size={15} /></button>
          <input
            className={`input sm lf-qty${!o.by_total && n > max + 0.001 ? " over" : ""}`}
            inputMode="decimal"
            value={v}
            placeholder="0"
            onChange={(e) => set(it.item, k, e.target.value)}
            aria-label={`${it.name} from ${what}`}
          />
          <button type="button" className="iconbtn sm" onClick={() => step(it.item, k, 1)} aria-label={`One more from ${what}`}><Plus size={15} /></button>
        </div>
      </div>
    );
  };
  /** Search for any item counted by total at this location and add it as what went out. */
  const picker = (it: FixItem) => {
    if (!stock.length) return null;
    const t = (find[it.item] ?? "").trim().toLowerCase();
    const have = new Set(optsOf(it).filter((o) => o.by_total).map((o) => o.product_id));
    const hits = t ? stock.filter((p) => !have.has(p.product_id) && t.split(/\s+/).every((w) => `${p.sku} ${p.name}`.toLowerCase().includes(w))).slice(0, 8) : [];
    return (
      <div className="lf-find">
        <input className="input sm" value={find[it.item] ?? ""} onChange={(e) => setFind((f) => ({ ...f, [it.item]: e.target.value }))}
          placeholder="Something counted by total went out? Type its SKU or name" aria-label={`Find another item that went out instead of ${it.name}`} />
        {hits.length ? (
          <div className="lf-hits">
            {hits.map((p) => (
              <button key={p.product_id} type="button" onClick={() => add(it, p)}>
                <b>{p.sku}</b> <span className="faint">· {p.name} · {q2(p.on_hand)} in stock</span>
              </button>
            ))}
          </div>
        ) : t ? <span className="tiny faint">Nothing counted by total matches.</span> : null}
      </div>
    );
  };

  return (
    <details className="card lotfix" open={false}>
      <summary><b>Fix what went out</b> <span className="tiny faint">· admins: what really left, lot by lot, any product</span></summary>
      <p className="tiny faint" style={{ margin: "6px 0 4px" }}>
        Type how many {items.every((i) => i.unit === items[0]?.unit) ? plural(items[0]?.unit ?? "drum", 2) : "drums"} came off each lot, the way the packing slip shows it.
        Another product went out (a different resin, drums instead of a tote, anything at this location)? Open &ldquo;A different product went out&rdquo;.
        Saving puts back what the app had recorded and takes off what you enter (Shipped Out on FOAM LOTS, or TOTAL IN STOCK on the COUNT SHEET), and the
        order&apos;s record and PENDING ORDERS are corrected. Prices and the invoice don&apos;t change. To change how many went out, use Edit order.
      </p>
      {items.map((it) => {
        const total = sumOf(it);
        const ok = Math.abs(total - it.total) < 0.001;
        const opts = optsOf(it);
        const same = opts.filter((o) => o.same_type);
        const other = opts.filter((o) => !o.same_type);
        const noLot = noLotOf(it);
        return (
          <section key={it.item} className="lf-item">
            <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
              <div className="col tight" style={{ minWidth: 0 }}>
                <b>{it.name}</b>
                <span className="tiny faint">{it.sku}{noLot ? ` · ${q2(noLot)} had no lot recorded: put them on their lot` : ""}</span>
              </div>
              <span className={`pill ${ok ? "ok" : "red"} nowrap`}>
                {ok ? <CircleCheck size={13} /> : <CircleAlert size={13} />} {q2(total)} of {q2(it.total)} {plural(it.unit, it.total)}
              </span>
            </div>
            {same.map((o) => row(it, o))}
            <details className="lf-other" open={other.some((o) => o.mine > 0 || o.by_total)}>
              <summary className="tiny">
                A different product went out{other.filter((o) => !o.by_total).length ? ` (${other.filter((o) => !o.by_total).length} lots, or anything counted by total)` : " (anything at this location)"}
              </summary>
              {other.filter((o) => !o.by_total).map((o) => row(it, o))}
              {other.filter((o) => o.by_total).map((o) => row(it, o))}
              {picker(it)}
            </details>
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
