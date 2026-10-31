"use client";

import { useMemo, useState } from "react";
import { CircleAlert, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { plural } from "@/lib/format";
import { ItemPick, type StockItem } from "@/components/incoming-forms";
import { sendTransfer } from "@/app/(app)/inventory/hub-actions";

// Send stock to another AMBIT location. Spray foam goes by lot, so the lot travels with the drums.

export type SendItem = StockItem & { available: number; lotList: { id: number; lot_no: string; available: number; use_by: string | null; expired: boolean }[] };

type Line = { key: number; item: SendItem | null; qty: string; lot: string };
let seq = 1;

const shortDate = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}` : "");

export function TransferForm({
  from,
  fromName,
  items,
  destinations,
  today,
}: {
  from: string;
  fromName: string;
  items: SendItem[];
  destinations: { id: string; name: string; stocks: string[] }[];
  today: string;
}) {
  const [to, setTo] = useState(destinations[0]?.id ?? "");
  const [arrive, setArrive] = useState(today);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: seq++, item: null, qty: "", lot: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dest = destinations.find((d) => d.id === to);
  const stocked = useMemo(() => new Set(dest?.stocks ?? []), [dest]);
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const send = async () => {
    setError(null);
    if (!to) return setError("Pick where it's going.");
    const out: { product_id: string; qty: number; lot_id?: number | null }[] = [];
    for (const l of lines) {
      if (!l.item && !l.qty) continue;
      if (!l.item) return setError("Pick the item for every line (or remove the line).");
      const q = /^\d+(\.\d{1,2})?$/.test(l.qty.trim()) ? Number(l.qty) : 0;
      if (q <= 0) return setError(`How many ${l.item.sku}?`);
      if (l.item.lots) {
        const lot = l.item.lotList.find((x) => String(x.id) === l.lot);
        if (!lot) return setError(`Pick the lot for ${l.item.sku}.`);
        if (q > lot.available) return setError(`Lot ${lot.lot_no} has ${lot.available} available.`);
        out.push({ product_id: l.item.product_id, qty: q, lot_id: lot.id });
      } else {
        if (q > l.item.available) return setError(`${fromName} has ${l.item.available} ${l.item.sku} available.`);
        out.push({ product_id: l.item.product_id, qty: q });
      }
      if (!stocked.has(l.item.product_id)) return setError(`${l.item.sku} isn't on ${dest?.name}'s inventory sheet. They need a row for it on their COUNT SHEET first.`);
    }
    if (!out.length) return setError("Add at least one item.");
    setBusy(true);
    const r = await sendTransfer({ from, to, arrive, ref, note, lines: out });
    setBusy(false);
    if (r && !r.ok) setError(r.error);
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <section className="card col" style={{ gap: 10 }}>
        <div className="grid2">
          <div className="field">
            <span className="label">From</span>
            <span className="small" style={{ padding: "8px 0" }}><b>{fromName}</b></span>
          </div>
          <label className="field">
            <span className="label">To</span>
            <select className="select sm" value={to} onChange={(e) => setTo(e.target.value)}>
              {destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Gets there</span>
            <input className="input sm" type="date" value={arrive} min={today} onChange={(e) => setArrive(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">BOL # / trailer / driver (optional)</span>
            <input className="input sm" value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
        </div>
      </section>

      <div className="eyebrow">What&apos;s going</div>
      <div className="col" style={{ gap: 10 }}>
        {lines.map((l) => {
          const notThere = l.item && !stocked.has(l.item.product_id);
          return (
            <div key={l.key} className="card col recv-line" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <ItemPick items={items} value={l.item} onPick={(it) => set(l.key, { item: it as SendItem, lot: "" })} />
                  {l.item ? (
                    <div className="tiny faint" style={{ marginTop: 4 }}>
                      {l.item.lots ? `${l.item.lotList.reduce((s, x) => s + Math.max(0, x.available), 0)} available across ${l.item.lotList.length} ${l.item.lotList.length === 1 ? "lot" : "lots"}` : `${l.item.available} ${plural(l.item.unit, l.item.available)} available`}
                    </div>
                  ) : null}
                  {notThere ? <div className="tiny warn-t" style={{ marginTop: 2 }}>{dest?.name} doesn&apos;t stock this yet: they need a row for it on their COUNT SHEET first.</div> : null}
                </div>
                <button type="button" className="iconbtn" aria-label="Remove this line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [{ key: seq++, item: null, qty: "", lot: "" }]))}>
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="grid2">
                {l.item?.lots ? (
                  <label className="field">
                    <span className="label">Lot</span>
                    <select className="select sm" value={l.lot} onChange={(e) => set(l.key, { lot: e.target.value })}>
                      <option value="">Pick the lot…</option>
                      {l.item.lotList.filter((x) => x.available > 0).map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.lot_no || "(no lot #)"} · {x.available} available{x.use_by ? ` · use by ${shortDate(x.use_by)}` : ""}{x.expired ? " · EXPIRED" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="field">
                  <span className="label">How many</span>
                  <input className="input sm" inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} placeholder={l.item ? plural(l.item.unit, 2) : ""} />
                </label>
              </div>
              {l.item?.lots ? (
                <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setLines((ls) => {
                  const i = ls.findIndex((x) => x.key === l.key);
                  return [...ls.slice(0, i + 1), { key: seq++, item: l.item, qty: "", lot: "" }, ...ls.slice(i + 1)];
                })}>
                  Another lot of this
                </button>
              ) : null}
            </div>
          );
        })}
        <button type="button" className="btn sm dark" style={{ alignSelf: "flex-start", gap: 6 }} onClick={() => setLines((ls) => [...ls, { key: seq++, item: null, qty: "", lot: "" }])}>
          <Plus size={16} /> Add another item
        </button>
      </div>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{error}</span></div> : null}
      <button type="button" className="btn" onClick={send} disabled={busy} style={{ gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} Send: take it off stock here
      </button>
      <p className="tiny faint center" style={{ margin: 0 }}>
        It comes off {fromName}&apos;s stock now (spray foam: Shipped Out on that lot&apos;s FOAM LOTS row) and shows as an incoming delivery at {dest?.name ?? "the other location"}. They receive it when the truck gets there.
      </p>
    </div>
  );
}
