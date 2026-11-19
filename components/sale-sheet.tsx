"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, FileSpreadsheet, Flame, Plus, Search, Trash2, Wand2, X } from "lucide-react";
import { addSaleItems, loadCosts, removeSaleItems, saveSalePrices, saveSaleSettings, type SaleResult } from "@/app/(app)/admin/sale/actions";

export type SaleRow = { id: string; sku: string; name: string; category: string; image: string | null; cost: number | null; price: number | null; foam: boolean; sale: number | null };
type Sale = { id: number; name: string; starts_on: string; ends_on: string; foam_off_per_lb: number | null };

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const pct = (v: number) => `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(1)}%`;
const markup = (price: number | null, cost: number | null) => (price === null || cost === null || cost <= 0 ? null : ((price - cost) / cost) * 100);
const num = (s: string) => {
  const v = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/**
 * A spreadsheet for the sale: our cost, today's price and markup, the sale price to type, and the sale markup worked out.
 * Tick rows to take them off the sale or fill them in one go (a % off today's price, or a markup on cost).
 */
export function SaleSheet({ sale, rows, others, costCount }: { sale: Sale; rows: SaleRow[]; others: SaleRow[]; costCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<SaleResult | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [missing, setMissing] = useState(false);
  const [sure, setSure] = useState(false);
  const [fillMode, setFillMode] = useState<"off" | "markup">("off");
  const [fillVal, setFillVal] = useState("10");
  const [addQ, setAddQ] = useState("");
  const [settings, setSettings] = useState({ name: sale.name, starts_on: sale.starts_on, ends_on: sale.ends_on, foam: sale.foam_off_per_lb === null ? "" : String(sale.foam_off_per_lb) });

  const bfText = (r: SaleRow) => (r.id in edits ? edits[r.id] : r.sale === null ? "" : r.sale.toFixed(2));
  const bf = (r: SaleRow) => num(bfText(r));
  const cats = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(
    (r) => (!cat || r.category === cat) && (!missing || bf(r) === null) && words.every((w) => `${r.sku} ${r.name} ${r.category}`.toLowerCase().includes(w)),
  );
  const changed = rows.filter((r) => r.id in edits && num(edits[r.id]) !== r.sale);
  const priced = rows.filter((r) => bf(r) !== null).length;

  const run = (fn: () => Promise<SaleResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setMsg(res);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  const toggle = (i: number, shift: boolean) => {
    const id = shown[i].id;
    setPicked((cur) => {
      const next = new Set(cur);
      const on = !cur.has(id);
      if (shift && last !== null) {
        const [a, b] = [Math.min(last, i), Math.max(last, i)];
        for (let k = a; k <= b; k++) (on ? next.add(shown[k].id) : next.delete(shown[k].id));
      } else if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setLast(i);
    setSure(false);
  };
  const allOn = shown.length > 0 && shown.every((r) => picked.has(r.id));
  const fill = () => {
    const v = Number(fillVal);
    if (!Number.isFinite(v)) return;
    const next = { ...edits };
    let n = 0;
    for (const r of rows) {
      if (!picked.has(r.id)) continue;
      const p = fillMode === "off" ? (r.price === null ? null : r.price * (1 - v / 100)) : r.cost === null ? null : r.cost * (1 + v / 100);
      if (p === null) continue;
      next[r.id] = (Math.round(p * 100) / 100).toFixed(2);
      n++;
    }
    setEdits(next);
    setMsg({ ok: true, message: `Filled ${n} ${n === 1 ? "price" : "prices"}. Press Save to keep them.` });
  };
  const onCosts = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: unknown[][] }[];
      const norm = (c: unknown) => String(c ?? "").trim().toLowerCase();
      const pick = sheets.find((s) => norm(s.sheet) === "item master") ?? sheets.find((s) => s.data.slice(0, 15).some((row) => row.some((c) => norm(c) === "our cost")));
      if (!pick) return setMsg({ ok: false, message: "That file has no Item Master sheet (or no Our Cost column)." });
      const h = pick.data.findIndex((row) => row.some((c) => norm(c) === "sku") && row.some((c) => norm(c) === "our cost"));
      if (h < 0) return setMsg({ ok: false, message: "Couldn't find the SKU and Our Cost headers." });
      const iS = pick.data[h].findIndex((c) => norm(c) === "sku");
      const iC = pick.data[h].findIndex((c) => norm(c) === "our cost");
      const list = pick.data
        .slice(h + 1)
        .map((row) => ({ sku: String(row[iS] ?? "").trim(), cost: Number(String(row[iC] ?? "").replace(/[$,\s]/g, "")) }))
        .filter((r) => r.sku && Number.isFinite(r.cost) && r.cost > 0);
      run(() => loadCosts(list, `${file.name} (${pick.sheet})`));
    } catch {
      setMsg({ ok: false, message: "Couldn't read that file. Pick the Item Master workbook (.xlsx)." });
    }
  };
  const addable = others.filter((r) => !r.foam && r.price !== null);
  const addWords = addQ.toLowerCase().split(/\s+/).filter(Boolean);
  const addShown = addWords.length ? addable.filter((r) => addWords.every((w) => `${r.sku} ${r.name}`.toLowerCase().includes(w))).slice(0, 12) : [];

  return (
    <div className="ss">
      <section className="card2 ss-set" aria-label="Sale settings">
        <label className="ss-f"><span>Name</span><input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} /></label>
        <label className="ss-f"><span>First day</span><input type="date" value={settings.starts_on} onChange={(e) => setSettings({ ...settings, starts_on: e.target.value })} /></label>
        <label className="ss-f"><span>Last day</span><input type="date" value={settings.ends_on} onChange={(e) => setSettings({ ...settings, ends_on: e.target.value })} /></label>
        <label className="ss-f ss-foam">
          <span><Flame size={14} aria-hidden="true" /> Spray foam: $ off per lb</span>
          <input inputMode="decimal" value={settings.foam} placeholder="0.05" onChange={(e) => setSettings({ ...settings, foam: e.target.value })} />
        </label>
        <button
          type="button"
          className="b2 sm quiet"
          disabled={pending}
          onClick={() => run(() => saveSaleSettings(sale.id, { name: settings.name, starts_on: settings.starts_on, ends_on: settings.ends_on, foam_off_per_lb: num(settings.foam) }))}
        >
          Save settings
        </button>
        <span className="ss-note">Foam is priced per customer, so it isn&apos;t on the sheet: each customer gets their own $/lb minus this amount. The store shows it on every foam item.</span>
      </section>

      <div className="stk-bar">
        <label className="stk-search">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU or item" aria-label="Find an item" />
        </label>
        <label className="stk-select">
          <span>Category</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button type="button" className={`b2 sm${missing ? "" : " quiet"}`} onClick={() => setMissing((v) => !v)}>
          {missing ? <X size={15} /> : null} No sale price yet · {rows.length - priced}
        </button>
        <label className="b2 sm quiet ss-file">
          <FileSpreadsheet size={16} /> {costCount ? "Update costs" : "Load our costs"}
          <input type="file" accept=".xlsx" hidden onChange={(e) => onCosts(e.target.files?.[0])} />
        </label>
      </div>

      {!costCount ? (
        <div className="alert info small">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>Our cost and markup fill in once you load the costs: tap <b>Load our costs</b> and pick the Item Master workbook (the one with the &ldquo;Our Cost&rdquo; column).</span>
        </div>
      ) : null}
      {msg ? (
        <div className={`alert ${msg.ok ? "ok" : "err"} small`} role="status">
          {msg.ok ? <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />}
          <span>{msg.message}</span>
        </div>
      ) : null}

      {picked.size ? (
        <div className="ss-picked" role="region" aria-label="Selected items">
          <b>{picked.size} selected</b>
          <span className="ss-fill">
            <Wand2 size={16} aria-hidden="true" />
            <select value={fillMode} onChange={(e) => setFillMode(e.target.value as "off" | "markup")} aria-label="Fill how">
              <option value="off">% off today&apos;s price</option>
              <option value="markup">% markup on our cost</option>
            </select>
            <input inputMode="decimal" value={fillVal} onChange={(e) => setFillVal(e.target.value)} aria-label="Percent" />
            <span>%</span>
            <button type="button" className="b2 sm quiet" onClick={fill}>Fill prices</button>
          </span>
          {sure ? (
            <button type="button" className="b2 sm ss-kill" disabled={pending} onClick={() => run(() => removeSaleItems(sale.id, [...picked]), () => { setPicked(new Set()); setSure(false); })}>
              <Trash2 size={15} /> Yes, take {picked.size} off the sale
            </button>
          ) : (
            <button type="button" className="b2 sm quiet" onClick={() => setSure(true)}><Trash2 size={15} /> Take off the sale</button>
          )}
          <button type="button" className="b2 sm quiet icon" onClick={() => { setPicked(new Set()); setSure(false); }} aria-label="Clear the selection"><X size={16} /></button>
        </div>
      ) : null}

      <div className="card2 ss-wrap">
        <table className="ss-t">
          <thead>
            <tr>
              <th className="ck"><input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(shown.map((r) => r.id)))} aria-label="Select every row shown" /></th>
              <th className="ph" aria-label="Photo" />
              <th>SKU</th>
              <th>Item</th>
              <th className="n">Our cost</th>
              <th className="n">Price now</th>
              <th className="n">Markup now</th>
              <th className="n bfh">{settings.name || "Sale"} price</th>
              <th className="n bfh">{settings.name || "Sale"} markup</th>
              <th className="n">Off</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const b = bf(r);
              const m0 = markup(r.price, r.cost);
              const m1 = markup(b, r.cost);
              const off = b !== null && r.price ? ((r.price - b) / r.price) * 100 : null;
              const dirty = r.id in edits && num(edits[r.id]) !== r.sale;
              return (
                <tr key={r.id} className={`${picked.has(r.id) ? "on" : ""}${dirty ? " dirty" : ""}`}>
                  <td className="ck">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => {}} onClick={(e) => toggle(i, e.shiftKey)} aria-label={`Select ${r.sku}`} />
                  </td>
                  <td className="ph">{r.image ? <img src={r.image} alt="" loading="lazy" /> : <span />}</td>
                  <td className="sku">{r.sku}</td>
                  <td className="nm"><b>{r.name}</b><span>{r.category}</span></td>
                  <td className="n">{r.cost === null ? <span className="faint">-</span> : usd(r.cost)}</td>
                  <td className="n">{r.price === null ? <span className="faint">-</span> : usd(r.price)}</td>
                  <td className="n">{m0 === null ? <span className="faint">-</span> : pct(m0)}</td>
                  <td className="n bf">
                    <span className="ss-in">
                      <span aria-hidden="true">$</span>
                      <input
                        inputMode="decimal"
                        value={bfText(r)}
                        placeholder="-"
                        onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            const el = document.querySelectorAll<HTMLInputElement>(".ss-in input")[i + (e.key === "ArrowUp" ? -1 : 1)];
                            el?.focus();
                            el?.select();
                          }
                        }}
                        aria-label={`${settings.name} price for ${r.sku}`}
                      />
                    </span>
                  </td>
                  <td className={`n bf${m1 !== null && m1 < 10 ? " low" : ""}`}>{m1 === null ? <span className="faint">-</span> : pct(m1)}</td>
                  <td className={`n${b !== null && r.price !== null && b >= r.price ? " warn" : ""}`}>{off === null ? <span className="faint">-</span> : pct(off)}</td>
                </tr>
              );
            })}
            {!shown.length ? <tr><td colSpan={10} className="ss-none">Nothing matches.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <details className="card2 ss-add">
        <summary><Plus size={16} /> Put an item back on the sale</summary>
        <div className="ss-add-in">
          <label className="stk-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="SKU or item" aria-label="Find an item to add" />
          </label>
          {addShown.map((r) => (
            <div key={r.id} className="ss-add-r">
              <span className="grow"><b>{r.sku}</b> {r.name}</span>
              <span className="faint">{r.price === null ? "" : usd(r.price)}</span>
              <button type="button" className="b2 sm quiet" disabled={pending} onClick={() => run(() => addSaleItems(sale.id, [r.id]))}><Plus size={15} /> Add</button>
            </div>
          ))}
        </div>
      </details>

      <div className={`ss-save${changed.length ? " on" : ""}`}>
        <span>{changed.length ? `${changed.length} unsaved ${changed.length === 1 ? "price" : "prices"}` : `${priced} of ${rows.length} items have a sale price`}</span>
        {changed.length ? <button type="button" className="b2 quiet sm" onClick={() => setEdits({})}>Undo</button> : null}
        <button
          type="button"
          className="b2"
          disabled={pending || !changed.length}
          onClick={() => run(() => saveSalePrices(sale.id, changed.map((r) => ({ product_id: r.id, price: num(edits[r.id]) }))), () => setEdits({}))}
        >
          {pending ? "Saving..." : "Save prices"}
        </button>
      </div>
    </div>
  );
}
