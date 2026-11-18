"use client";

import { useMemo, useState } from "react";
import { CircleAlert, LoaderCircle, Minus, Plus, Search, Trash2 } from "lucide-react";
import { saveOrderSheet } from "@/app/(app)/orders/actions";
import { dateShort, plural } from "@/lib/format";

// Edit order as a sheet (0086): add as many rows as you like, any item in inventory, the same resin or ISO on as many
// rows as you need, each on its own lot. Rows of one item add up to its quantity.

export type SheetProduct = { product_id: string; sku: string; name: string; unit: string; byLot: boolean };
/** A lot at the order's location; product_id is the item it sells as (ISO for an ISO-WANHUA lot). */
export type SheetLot = { lot_id: number; product_id: string; sku: string; lot_no: string | null; exp: string | null; remaining: number; on_sheet: boolean };
export type SheetStart = { item_id: number | null; product_id: string | null; sku: string; name: string; unit: string; lot_id: number | null; qty: number };

type Row = { key: string; item_id: number | null; product_id: string | null; sku: string; name: string; unit: string; lot: string; qty: string; finding: boolean; find: string };

const num = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Number(s) : null);
const flat = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const q2 = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
let seq = 0;
const key = () => `r${++seq}`;

export function OrderSheet({
  orderId,
  closed,
  next,
  products,
  lots,
  start,
  noneRecorded = [],
}: {
  orderId: string;
  closed: boolean;
  next: string;
  products: SheetProduct[];
  lots: SheetLot[];
  start: SheetStart[];
  /** Completed order: items with nothing recorded as gone out ("Just record the lots"). */
  noneRecorded?: string[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    start.map((r) => ({ key: key(), item_id: r.item_id, product_id: r.product_id, sku: r.sku, name: r.name, unit: r.unit, lot: r.lot_id ? String(r.lot_id) : "", qty: q2(r.qty), finding: false, find: "" })),
  );
  const [note, setNote] = useState("");
  const [belowZero, setBelowZero] = useState(true);
  const [recordOnly, setRecordOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prodOf = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const lotOf = useMemo(() => new Map(lots.map((l) => [String(l.lot_id), l])), [lots]);
  const lotsFor = (pid: string | null) => (pid ? lots.filter((l) => l.product_id === pid).sort((a, b) => Number(b.on_sheet) - Number(a.on_sheet) || b.remaining - a.remaining) : []);
  const set = (k: string, patch: Partial<Row>) => {
    setError(null);
    setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((rs) => [...rs, { key: key(), item_id: null, product_id: null, sku: "", name: "", unit: "drum", lot: "", qty: "1", finding: true, find: "" }]);

  // Before and after, per item.
  const before = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; qty: number; lots: Map<string, number> }>();
    for (const r of start) {
      const k = r.product_id ?? `i${r.item_id}`;
      const v = m.get(k) ?? { name: r.name, unit: r.unit, qty: 0, lots: new Map() };
      v.qty += r.qty;
      if (r.lot_id) v.lots.set(String(r.lot_id), (v.lots.get(String(r.lot_id)) ?? 0) + r.qty);
      m.set(k, v);
    }
    return m;
  }, [start]);
  const after = new Map<string, { name: string; unit: string; qty: number; lots: Map<string, number>; noLot: number; byLot: boolean }>();
  for (const r of rows) {
    if (!r.product_id && !r.item_id) continue;
    const q = num(r.qty) ?? 0;
    const k = r.product_id ?? `i${r.item_id}`;
    const v = after.get(k) ?? { name: r.name, unit: r.unit, qty: 0, lots: new Map(), noLot: 0, byLot: !!(r.product_id && (prodOf.get(r.product_id)?.byLot || lotsFor(r.product_id).length)) };
    v.qty += q;
    if (r.lot && q > 0) v.lots.set(r.lot, (v.lots.get(r.lot) ?? 0) + q);
    else v.noLot += q;
    after.set(k, v);
  }
  const lotText = (m: Map<string, number>) => [...m.entries()].map(([id, q]) => `${q2(q)} × lot ${lotOf.get(id)?.lot_no ?? "(no lot #)"}`).join(" + ");
  const changes: string[] = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b) {
      if (a.qty > 0) changes.push(`Added ${a.name}: ${q2(a.qty)} ${plural(a.unit, a.qty)}${a.lots.size ? ` (${lotText(a.lots)})` : ""}`);
      continue;
    }
    if (Math.abs(a.qty - b.qty) > 0.001) changes.push(a.qty === 0 ? `Removed ${a.name} (was ${q2(b.qty)})` : `${a.name}: ${q2(b.qty)} → ${q2(a.qty)} ${plural(a.unit, a.qty)}`);
    if (a.lots.size && lotText(a.lots) !== lotText(b.lots)) changes.push(`${a.name}: ${lotText(a.lots)}`);
  }
  for (const [k, b] of before) if (!after.has(k)) changes.push(`Removed ${b.name} (was ${q2(b.qty)})`);
  // Gone out already: an item counted by lot needs a lot on every row once any row has one.
  const partial = closed ? [...after.values()].filter((a) => a.lots.size > 0 && a.noLot > 0) : [];
  const bad = rows.find((r) => (r.product_id || r.item_id) && num(r.qty) === null);
  const blank = rows.find((r) => !r.product_id && !r.item_id && !r.finding);

  const save = async () => {
    setError(null);
    if (bad) return setError(`Check the quantity on the ${bad.sku} row (a number, 0 to take it off).`);
    if (!changes.length) return setError("Nothing changed yet.");
    if (partial.length) return setError(`${partial[0].name}: give every row a lot (or none), since it already went out.`);
    setBusy(true);
    const res = await saveOrderSheet({
      id: orderId,
      rows: rows.filter((r) => r.product_id || r.item_id).map((r) => ({ item_id: r.product_id ? null : r.item_id, product_id: r.product_id, lot_id: r.lot ? Number(r.lot) : null, qty: num(r.qty) ?? 0 })),
      note,
      belowZero,
      recordOnly,
    });
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  };

  const finder = (r: Row) => {
    const words = r.find.toLowerCase().split(/\s+/).filter(Boolean);
    const lotHits = words.length
      ? lots
          .filter((l) => {
            const p = prodOf.get(l.product_id);
            const hay = `${l.sku} ${p?.sku ?? ""} ${p?.name ?? ""} ${l.lot_no ?? ""} ${flat(l.lot_no)}`.toLowerCase();
            return words.every((w) => hay.includes(w) || (flat(w).length >= 3 && hay.includes(flat(w).toLowerCase())));
          })
          .sort((a, b) => Number(b.on_sheet) - Number(a.on_sheet) || b.remaining - a.remaining)
          .slice(0, 10)
      : [];
    const prodHits = words.length ? products.filter((p) => words.every((w) => `${p.sku} ${p.name}`.toLowerCase().includes(w))).slice(0, 10) : [];
    const pickProduct = (p: SheetProduct) => set(r.key, { product_id: p.product_id, item_id: null, sku: p.sku, name: p.name, unit: p.unit, lot: "", finding: false, find: "" });
    const pickLot = (l: SheetLot) => {
      const p = prodOf.get(l.product_id);
      set(r.key, { product_id: l.product_id, item_id: null, sku: p?.sku ?? l.sku, name: p?.name ?? l.sku, unit: p?.unit ?? "drum", lot: String(l.lot_id), finding: false, find: "" });
    };
    return (
      <div className="sheet-find">
        <div className="search">
          <Search size={16} />
          <input className="input sm" autoFocus value={r.find} onChange={(e) => set(r.key, { find: e.target.value })} placeholder="SKU, name, brand or lot # (AP9166AB, Covestro, ISO, LW8019…)" aria-label="Find an item or lot" />
        </div>
        {lotHits.length || prodHits.length ? (
          <div className="list pick-hits">
            {lotHits.map((l) => (
              <button key={`l${l.lot_id}`} type="button" className="item" onClick={() => pickLot(l)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">Lot {l.lot_no || "(no lot #)"} · {l.sku}</div>
                  <div className="s ellipsis">{prodOf.get(l.product_id)?.name ?? ""} · {q2(l.remaining)} left{l.exp ? ` · exp ${dateShort(l.exp)}` : ""}{l.on_sheet ? "" : " · not on FOAM LOTS"}</div>
                </div>
              </button>
            ))}
            {prodHits.map((p) => (
              <button key={p.product_id} type="button" className="item" onClick={() => pickProduct(p)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">{p.sku}</div>
                  <div className="s ellipsis">{p.name}{p.byLot ? " · by lot" : ""}</div>
                </div>
              </button>
            ))}
          </div>
        ) : words.length ? <span className="tiny faint">Nothing in inventory matches &ldquo;{r.find}&rdquo;.</span> : null}
        {r.product_id ? <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => set(r.key, { finding: false, find: "" })}>Keep {r.sku}</button> : null}
      </div>
    );
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="sheet">
        <div className="sheet-head tiny">
          <span>Item</span>
          <span>Lot</span>
          <span>Qty</span>
          <span />
        </div>
        {rows.map((r) => {
          const opts = lotsFor(r.product_id);
          const q = num(r.qty);
          return (
            <div key={r.key} className={`sheet-row${q === 0 ? " removed" : ""}`}>
              <div className="sheet-item">
                {r.finding || (!r.product_id && !r.item_id) ? (
                  finder(r)
                ) : (
                  <button type="button" className="sheet-pick" onClick={() => r.product_id && set(r.key, { finding: true })} disabled={!r.product_id} title={r.product_id ? "Change the item" : undefined}>
                    <b>{r.sku}</b>
                    <span className="tiny faint ellipsis">{r.name}</span>
                  </button>
                )}
              </div>
              <div className="sheet-lot">
                {opts.length ? (
                  <select className="select sm" value={r.lot} onChange={(e) => set(r.key, { lot: e.target.value })} aria-label={`Lot for the ${r.sku} row`}>
                    <option value="">{closed ? "No lot" : "Any lot (the app picks)"}</option>
                    {opts.map((l) => (
                      <option key={l.lot_id} value={l.lot_id}>
                        {l.lot_no || "(no lot #)"}{l.sku.toUpperCase() !== r.sku.toUpperCase() ? ` · ${l.sku}` : ""} · {q2(l.remaining)} left{l.on_sheet ? "" : " · off FOAM LOTS"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="tiny faint">{r.product_id ? "Counted by total" : ""}</span>
                )}
              </div>
              <div className="sheet-qty">
                <button type="button" className="iconbtn sm" aria-label="One less" onClick={() => set(r.key, { qty: q2(Math.max(0, (num(r.qty) ?? 0) - 1)) })}><Minus size={15} /></button>
                <input className="input sm" inputMode="decimal" value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} aria-label={`Quantity on the ${r.sku} row`} />
                <button type="button" className="iconbtn sm" aria-label="One more" onClick={() => set(r.key, { qty: q2((num(r.qty) ?? 0) + 1) })}><Plus size={15} /></button>
              </div>
              <button type="button" className="iconbtn sm sheet-del" aria-label="Delete this row" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 size={15} /></button>
            </div>
          );
        })}
        <button type="button" className="btn sm dark sheet-add" onClick={addRow}><Plus size={16} /> Add a row</button>
      </div>
      <span className="tiny faint">
        Add as many rows as you need. Put the same item on two rows to split it across lots (15 from one lot, 1 from another). Delete a row, or set it to
        0, to take it off.
      </span>

      <label className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <input type="checkbox" checked={belowZero} onChange={(e) => setBelowZero(e.target.checked)} style={{ marginTop: 3 }} />
        <span className="small"><b>Let a lot go below zero.</b> <span className="muted">Use the lot you pick even when it shows fewer (Admin &gt; Data check lists every lot below zero).</span></span>
      </label>
      {closed && noneRecorded.length ? (
        <label className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <input type="checkbox" checked={recordOnly} onChange={(e) => setRecordOnly(e.target.checked)} style={{ marginTop: 3 }} />
          <span className="small"><b>Just record the lots, don&apos;t change stock.</b> <span className="muted">For items with no lots recorded yet whose drums are already off the count.</span></span>
        </label>
      ) : null}

      <label className="field">
        <span className="label">Why (shows in the order history)</span>
        <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Javier: 15 from AP9166AB, 1 from AP9168AB" />
      </label>

      {changes.length ? (
        <section className="card col" style={{ gap: 4 }}>
          <b className="small">What changes</b>
          <ul className="edit-changes small">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      ) : null}
      {partial.length ? <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{partial.map((p) => p.name).join(", ")}: give every row a lot, since it already went out.</span></div> : null}
      {blank ? <span className="tiny faint">Pick an item for the empty row, or delete it.</span> : null}
      <div className="alert info small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{next}</span></div>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="button" className="btn" onClick={save} disabled={busy || !changes.length} style={{ gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} Save changes
      </button>
    </div>
  );
}
