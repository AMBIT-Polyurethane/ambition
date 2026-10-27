"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import { plural, qtyText } from "@/lib/format";
import { receiveIncoming, saveIncoming, type IncomingInput, type ReceiveLine } from "@/app/(app)/inventory/count-actions";

export type StockItem = { product_id: string; sku: string; name: string; unit: string; lots: boolean };

/** Pick an item: type part of the SKU or name. */
function ItemPick({ items, value, onPick }: { items: StockItem[]; value: StockItem | null; onPick: (i: StockItem) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(
    () => (words.length ? items.filter((i) => words.every((w) => `${i.sku} ${i.name}`.toLowerCase().includes(w))).slice(0, 8) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, items],
  );
  if (value && !open) {
    return (
      <button type="button" className="pick-chosen" onClick={() => setOpen(true)}>
        <b>{value.sku}</b> <span className="faint">{value.name}</span>
      </button>
    );
  }
  return (
    <div className="pick-box">
      <div className="search">
        <Search size={16} />
        <input className="input sm" autoFocus={open} value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU or item name" aria-label="Find the item" />
      </div>
      {hits.length ? (
        <div className="list pick-hits">
          {hits.map((i) => (
            <button
              key={i.product_id}
              type="button"
              className="item"
              onClick={() => {
                onPick(i);
                setQ("");
                setOpen(false);
              }}
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t ellipsis">{i.sku}</div>
                <div className="s ellipsis">{i.name}{i.lots ? " · by lot" : ""}</div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type Draft = { key: number; item: StockItem | null; qty: string };

/** Add (or change) an expected delivery: who it's from, when, and what's on it. */
export function IncomingForm({
  items,
  branches,
  vendors,
  initial,
}: {
  items: StockItem[];
  branches: { id: string; name: string }[];
  vendors: string[];
  initial?: { id: number; branch: string; vendor: string; expected: string; ref: string; note: string; lines: { product_id: string; qty: number }[] };
}) {
  const [branch, setBranch] = useState(initial?.branch ?? branches[0]?.id ?? "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [expected, setExpected] = useState(initial?.expected ?? "");
  const [ref, setRef] = useState(initial?.ref ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const byId = useMemo(() => new Map(items.map((i) => [i.product_id, i])), [items]);
  const [lines, setLines] = useState<Draft[]>(() =>
    initial?.lines.length ? initial.lines.map((l, k) => ({ key: k, item: byId.get(l.product_id) ?? null, qty: String(l.qty) })) : [{ key: 0, item: null, qty: "" }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const good = lines.filter((l) => l.item && Number(l.qty) > 0);
    if (!vendor.trim()) return setError("Who is it coming from?");
    if (!expected) return setError("Pick the day it's expected.");
    if (!good.length) return setError("Add at least one item and how many.");
    setBusy(true);
    const input: IncomingInput = {
      id: initial?.id ?? null,
      branch,
      vendor,
      expected,
      ref,
      note,
      lines: good.map((l) => ({ product_id: l.item!.product_id, qty: Number(l.qty) })),
    };
    const r = await saveIncoming(input);
    setBusy(false);
    if (r && !r.ok) setError(r.error);
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid2">
        {branches.length > 1 ? (
          <label className="field">
            <span className="label">Location</span>
            <select className="select sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="label">From (vendor)</span>
          <input className="input sm" list="vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Covestro" />
          <datalist id="vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
        </label>
        <label className="field">
          <span className="label">Expected</span>
          <input className="input sm" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">PO # / BOL # / carrier (optional)</span>
          <input className="input sm" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>
      <div className="eyebrow">What&apos;s on it</div>
      <div className="col" style={{ gap: 8 }}>
        {lines.map((l, i) => (
          <div key={l.key} className="in-line">
            <div className="grow" style={{ minWidth: 0 }}>
              <ItemPick items={items} value={l.item} onPick={(it) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, item: it } : x)))} />
            </div>
            <input
              className="input sm in-qty"
              inputMode="decimal"
              value={l.qty}
              onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
              placeholder={l.item ? plural(l.item.unit, 2) : "How many"}
              aria-label="How many"
            />
            <button type="button" className="iconbtn" aria-label="Remove this item" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [{ key: Date.now(), item: null, qty: "" }]))} disabled={lines.length === 1 && !l.item && i === 0}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button type="button" className="btn sm dark" style={{ alignSelf: "flex-start", gap: 6 }} onClick={() => setLines((ls) => [...ls, { key: Date.now(), item: null, qty: "" }])}>
          <Plus size={16} /> Add another item
        </button>
      </div>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="button" className="btn" onClick={save} disabled={busy} style={{ gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} {initial ? "Save changes" : "Add expected delivery"}
      </button>
    </div>
  );
}

type RLine = { id: number; sku: string; name: string | null; unit: string | null; qty: number; lots: boolean };

/** The truck is here: what actually came (spray foam needs its lot # and dates), then Received. */
export function ReceiveForm({ deliveryId, lines }: { deliveryId: number; lines: RLine[] }) {
  const [v, setV] = useState<Record<number, { qty: string; lot: string; mfg: string; exp: string }>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { qty: String(Number(l.qty)), lot: "", mfg: "", exp: "" }])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (id: number, k: "qty" | "lot" | "mfg" | "exp", val: string) => setV((s) => ({ ...s, [id]: { ...s[id], [k]: val } }));

  const receive = async () => {
    setError(null);
    for (const l of lines) {
      const x = v[l.id];
      if (!/^\d+(\.\d{1,2})?$/.test(x.qty.trim())) return setError(`How many ${l.sku} came? (0 if none)`);
      if (l.lots && Number(x.qty) > 0 && !x.lot.trim()) return setError(`Enter the lot # for ${l.sku}.`);
    }
    setBusy(true);
    const out: ReceiveLine[] = lines.map((l) => ({
      id: l.id,
      received_qty: Number(v[l.id].qty),
      lot_no: l.lots ? v[l.id].lot.trim() : undefined,
      mfg: l.lots && v[l.id].mfg ? v[l.id].mfg : undefined,
      exp: l.lots && v[l.id].exp ? v[l.id].exp : undefined,
    }));
    const r = await receiveIncoming(deliveryId, out);
    setBusy(false);
    if (r && !r.ok) setError(r.error);
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      {lines.map((l) => (
        <div key={l.id} className="card col recv-line" style={{ gap: 8 }}>
          <div>
            <b>{l.sku}</b> <span className="small muted">{l.name}</span>
            <div className="tiny faint">Expected {l.unit ? qtyText(Number(l.qty), l.unit) : Number(l.qty)}{l.lots ? " · spray foam, tracked by lot" : ""}</div>
          </div>
          <div className={l.lots ? "grid4" : "grid2"}>
            <label className="field">
              <span className="label">Came in</span>
              <input className="input sm" inputMode="decimal" value={v[l.id].qty} onChange={(e) => set(l.id, "qty", e.target.value)} />
            </label>
            {l.lots ? (
              <>
                <label className="field">
                  <span className="label">Lot #</span>
                  <input className="input sm" value={v[l.id].lot} onChange={(e) => set(l.id, "lot", e.target.value.toUpperCase())} autoCapitalize="characters" />
                </label>
                <label className="field">
                  <span className="label">Mfg date</span>
                  <input className="input sm" type="date" value={v[l.id].mfg} onChange={(e) => set(l.id, "mfg", e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">Exp date</span>
                  <input className="input sm" type="date" value={v[l.id].exp} onChange={(e) => set(l.id, "exp", e.target.value)} />
                </label>
              </>
            ) : null}
          </div>
        </div>
      ))}
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="button" className="btn" onClick={receive} disabled={busy} style={{ gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} Received: add to stock
      </button>
      <p className="tiny faint center" style={{ margin: 0 }}>
        Everything else goes onto TOTAL IN STOCK. Spray foam goes onto FOAM LOTS: a new lot gets its own row, a lot that&apos;s already there gets Shipped In.
      </p>
    </div>
  );
}
