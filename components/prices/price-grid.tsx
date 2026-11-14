"use client";

import { memo, useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Download, FileUp, Search, Undo2 } from "lucide-react";
import { BASIS_LABEL, basisFor, type Basis, type PriceEdit, type PriceItem } from "@/lib/prices";
import { savePrices } from "@/app/(app)/prices/actions";

// The master price sheet: customers down the side, items across the top. Type, paste a block straight from Excel,
// or import a whole file. Nothing changes until Save. (NetSuite will fill this same sheet later.)

export type GridCust = { id: string; name: string; account_no: string | null; qb_name: string | null; rep: string | null };
type Saved = { price: number; basis: Basis };
type Edit = { price: string; basis: Basis; from: "typed" | "import" };
const PAGE = 50;
const key = (c: string, p: string) => `${c}|${p}`;
const num = (s: string) => s.replace(/[$,\s]/g, "");
const fmt = (n: number) => String(Math.round(n * 10000) / 10000);
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\b(llc|inc|co|corp|company|ltd|the|dba)\b/g, "").replace(/[^a-z0-9]+/g, "");
const cell = (c: unknown) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));
const basisOf = (s: string): Basis | null => (/lb|pound/i.test(s) ? "lb" : /sq|ft|square/i.test(s) ? "sqft" : /unit|each|drum|bag|ea\b/i.test(s) ? "unit" : null);

const Cell = memo(function Cell({ r, c, value, dirty, imported, onChange, onPaste, onKey }: {
  r: number; c: number; value: string; dirty: boolean; imported: boolean;
  onChange: (r: number, c: number, v: string) => void; onPaste: (r: number, c: number, text: string) => boolean; onKey: (r: number, c: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <td className={`pg-cell${dirty ? (imported ? " imp" : " dirty") : ""}`}>
      <input data-r={r} data-c={c} value={value} inputMode="decimal" placeholder="·" aria-label={`Row ${r + 1}, column ${c + 1}`}
        onChange={(e) => onChange(r, c, e.target.value)} onKeyDown={(e) => onKey(r, c, e)}
        onPaste={(e) => { if (onPaste(r, c, e.clipboardData.getData("text"))) e.preventDefault(); }} />
    </td>
  );
});

export function PriceGrid({ customers, items, cats, prices, initialQ = "" }: { customers: GridCust[]; items: PriceItem[]; cats: { id: string; name: string }[]; prices: { company_id: string; product_id: string; price: number; basis: Basis }[]; initialQ?: string }) {
  const router = useRouter();
  const saved = useMemo(() => new Map<string, Saved>(prices.map((p) => [key(p.company_id, p.product_id), { price: Number(p.price), basis: p.basis }])), [prices]);
  const pricedItems = useMemo(() => new Set(prices.map((p) => p.product_id)), [prices]);
  const pricedCust = useMemo(() => new Set(prices.map((p) => p.company_id)), [prices]);
  const [cat, setCat] = useState(cats.find((c) => c.id === "ambit-foam") ? "ambit-foam" : cats[0]?.id ?? "");
  const [q, setQ] = useState(initialQ);
  const [only, setOnly] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [page, setPage] = useState(0);
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [report, setReport] = useState<{ file: string; rows: number; applied: number; same: number; custs: string[]; skus: string[] } | null>(null);
  const [pending, go] = useTransition();
  const tableRef = useRef<HTMLTableElement>(null);

  const cols = useMemo(() => items.filter((p) => p.category_id === cat && (!hideEmpty || pricedItems.has(p.id) || [...edits.keys()].some((k) => k.endsWith(`|${p.id}`)))), [items, cat, hideEmpty, pricedItems, edits]);
  const t = q.trim().toLowerCase();
  const rows = useMemo(() => customers.filter((c) => (!t || `${c.name} ${c.account_no ?? ""} ${c.qb_name ?? ""}`.toLowerCase().includes(t)) && (!only || pricedCust.has(c.id) || [...edits.keys()].some((k) => k.startsWith(`${c.id}|`)))), [customers, t, only, pricedCust, edits]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const view = rows.slice(pg * PAGE, pg * PAGE + PAGE);

  const valueOf = (c: string, p: string) => { const e = edits.get(key(c, p)); if (e) return e.price; const s = saved.get(key(c, p)); return s ? fmt(s.price) : ""; };
  const isDirty = (k: string, e: Edit) => { const s = saved.get(k); const v = num(e.price); return v === "" ? !!s : !s || Number(v) !== s.price || e.basis !== s.basis; };
  const dirty = [...edits.entries()].filter(([k, e]) => isDirty(k, e));

  const put = useCallback((m: Map<string, Edit>, c: string, p: PriceItem, v: string, from: Edit["from"], basis?: Basis | null) => {
    const k = key(c, p.id);
    m.set(k, { price: num(v).replace(/[^\d.]/g, ""), basis: basis ?? saved.get(k)?.basis ?? basisFor(p), from });
  }, [saved]);

  const onChange = useCallback((r: number, ci: number, v: string) => {
    setMsg(null);
    setEdits((m) => { const n = new Map(m); put(n, view[r].id, cols[ci], v, "typed"); return n; });
  }, [view, cols, put]);

  // Paste a block from Excel or Google Sheets: it fills right and down from this cell.
  const onPaste = useCallback((r: number, ci: number, text: string) => {
    if (!/[\t\n]/.test(text.trim())) return false;
    const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    setEdits((m) => {
      const n = new Map(m);
      grid.forEach((line, i) => line.forEach((v, j) => { const c = view[r + i]; const p = cols[ci + j]; if (c && p && (num(v) === "" || /^\d*\.?\d+$/.test(num(v)))) put(n, c.id, p, v, "typed"); }));
      return n;
    });
    setMsg({ ok: true, text: `Pasted ${grid.length} row${grid.length === 1 ? "" : "s"} × ${Math.max(...grid.map((l) => l.length))} column${grid[0].length === 1 ? "" : "s"}. Check them, then Save.` });
    return true;
  }, [view, cols, put]);

  const onKey = useCallback((r: number, ci: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const to = e.key === "Enter" || e.key === "ArrowDown" ? [r + 1, ci] : e.key === "ArrowUp" ? [r - 1, ci]
      : e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length ? [r, ci + 1]
      : e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0 ? [r, ci - 1] : null;
    if (!to) return;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${to[0]}"][data-c="${to[1]}"]`);
    if (el) { e.preventDefault(); el.focus(); el.select(); }
  }, []);

  // A whole file: long (Customer, SKU, Price, Per, …) or wide (Customer, then one column per SKU or item name).
  async function importFile(f: File) {
    setMsg(null);
    let grid: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = (await readXlsxFile(f)) as unknown as { sheet: string; data: unknown[][] }[];
      grid = (sheets[0]?.data ?? []).map((r) => r.map(cell));
    } else grid = Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data.map((r) => r.map(cell));
    const byQb = new Map(customers.filter((c) => c.qb_name).map((c) => [String(c.qb_name).toLowerCase(), c.id]));
    const byName = new Map(customers.map((c) => [norm(c.name), c.id]));
    const byAcct = new Map(customers.filter((c) => c.account_no).map((c) => [String(c.account_no).toLowerCase(), c.id]));
    const findC = (s: string) => { const v = s.trim(); return byQb.get(v.toLowerCase()) || byAcct.get(v.toLowerCase()) || byName.get(norm(v)) || byName.get(norm(v.split(":").pop() ?? "")) || null; };
    const bySku = new Map(items.map((p) => [p.sku.toLowerCase(), p]));
    const byItem = new Map(items.map((p) => [norm(p.name), p]));
    const findP = (s: string) => bySku.get(s.trim().toLowerCase()) || byItem.get(norm(s)) || null;
    const headAt = grid.findIndex((r) => r.some((h) => /customer|company|account/i.test(h)));
    if (headAt < 0) return setMsg({ ok: false, text: "Couldn't find a Customer column. The first row should have Customer, then SKU and Price (or one column per item)." });
    const head = grid[headAt].map((h) => h.trim());
    const ci = head.findIndex((h) => /customer|company/i.test(h)) >= 0 ? head.findIndex((h) => /customer|company/i.test(h)) : head.findIndex((h) => /account/i.test(h));
    const si = head.findIndex((h) => /^(sku|item|product|item #|item number|part)/i.test(h));
    const pi = head.findIndex((h) => /^(price|customer price|their price|rate|amount)$/i.test(h));
    const bi = head.findIndex((h) => /^(per|basis|uom|priced per|unit of measure)$/i.test(h));
    const missC = new Set<string>(); const missP = new Set<string>();
    let n = 0; let applied = 0; let same = 0;
    const next = new Map(edits);
    const apply = (cRaw: string, pRaw: string, vRaw: string, bRaw?: string) => {
      const v = num(vRaw);
      if (v === "" || !/^\d*\.?\d+$/.test(v)) return;
      n++;
      const c = findC(cRaw); const p = findP(pRaw);
      if (!c) { missC.add(cRaw.trim()); return; }
      if (!p) { missP.add(pRaw.trim()); return; }
      const b = (bRaw ? basisOf(bRaw) : null) ?? saved.get(key(c, p.id))?.basis ?? basisFor(p);
      const s = saved.get(key(c, p.id));
      if (s && s.price === Number(v) && s.basis === b) { same++; next.delete(key(c, p.id)); return; }
      put(next, c, p, v, "import", b); applied++;
    };
    if (si >= 0 && pi >= 0) for (const r of grid.slice(headAt + 1)) apply(r[ci] ?? "", r[si] ?? "", r[pi] ?? "", bi >= 0 ? r[bi] : undefined);
    else {
      const colP = head.map((h, j) => (j === ci ? null : findP(h)));
      head.forEach((h, j) => { if (j !== ci && h && !colP[j] && !/^(account|rep|terms|notes?)$/i.test(h)) missP.add(h); });
      for (const r of grid.slice(headAt + 1)) colP.forEach((p, j) => { if (p) apply(r[ci] ?? "", p.sku, r[j] ?? ""); });
    }
    setEdits(next);
    setReport({ file: f.name, rows: n, applied, same, custs: [...missC], skus: [...missP] });
    const firstCat = [...next.keys()].map((k) => items.find((p) => p.id === k.split("|")[1])?.category_id).find(Boolean);
    if (firstCat && !cols.some((p) => next.has(key(view[0]?.id ?? "", p.id)))) setCat(firstCat);
  }

  function download() {
    const head = ["Customer", "Account #", ...cols.map((p) => `${p.sku}`)];
    const lines = [head, ["", "", ...cols.map((p) => `${p.name} (${BASIS_LABEL[basisFor(p)]})`)], ...rows.map((c) => [c.name, c.account_no ?? "", ...cols.map((p) => valueOf(c.id, p.id))])];
    const csv = Papa.unparse(lines.filter((l, i) => i !== 1));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `customer-prices-${cat}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function save() {
    const toItem = ([k, e]: [string, Edit]): PriceEdit => { const [company_id, product_id] = k.split("|"); return { company_id, product_id, price: num(e.price) || null, basis: e.basis }; };
    const typed = dirty.filter(([, e]) => e.from === "typed").map(toItem);
    const imp = dirty.filter(([, e]) => e.from === "import").map(toItem);
    go(async () => {
      let total = 0;
      for (const [list, src] of [[imp, "import"], [typed, "manual"]] as const) {
        if (!list.length) continue;
        const r = await savePrices(list, src, src === "import" ? report?.file : undefined);
        if (!r.ok) return setMsg({ ok: false, text: r.error });
        total += r.saved;
      }
      setEdits(new Map()); setReport(null);
      setMsg({ ok: true, text: `Saved ${total} price${total === 1 ? "" : "s"}.` });
      router.refresh();
    });
  }

  const dirtyIn = (catId: string) => dirty.filter(([k]) => items.find((p) => p.id === k.split("|")[1])?.category_id === catId).length;

  return (
    <div className="col" style={{ gap: 12, paddingBottom: dirty.length ? 70 : 0 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="search grow" style={{ minWidth: 220 }}><Search size={18} /><input className="input" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Customer or account #" aria-label="Search customers" /></div>
        <label className="btn sm dark"><FileUp size={15} /> Import a spreadsheet<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} /></label>
        <button type="button" className="btn sm dark" onClick={download}><Download size={15} /> Download this sheet</button>
      </div>
      <div className="chips wrap">
        {cats.filter((c) => items.some((p) => p.category_id === c.id)).map((c) => (
          <button key={c.id} type="button" className={`chip sm${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>{c.name}{dirtyIn(c.id) ? <span className="chip-n">{dirtyIn(c.id)}</span> : null}</button>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 14 }}>
        <label className="check small"><input type="checkbox" checked={only} onChange={(e) => { setOnly(e.target.checked); setPage(0); }} /> Only customers with prices</label>
        <label className="check small"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide items nobody has a price for</label>
        <span className="tiny faint grow" style={{ textAlign: "right" }}>Tip: copy a block of prices in Excel, click the first cell here and paste. Enter and the arrow keys move around.</span>
      </div>

      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`}>{msg.ok ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<span>{msg.text}</span></div> : null}
      {report ? (
        <div className="card col" style={{ gap: 6 }}>
          <b className="small">From {report.file}: {report.rows} prices · <span className="ok-text">{report.applied} to change</span> · {report.same} already the same</b>
          {report.custs.length ? <span className="tiny warn-text">Customers not in the app ({report.custs.length}): {report.custs.slice(0, 12).join(", ")}{report.custs.length > 12 ? "…" : ""}</span> : null}
          {report.skus.length ? <span className="tiny warn-text">Items not found ({report.skus.length}): {report.skus.slice(0, 12).join(", ")}{report.skus.length > 12 ? "…" : ""}</span> : null}
          <span className="tiny faint">The changes are in the sheet in blue. Nothing is saved until you tap Save.</span>
        </div>
      ) : null}

      {cols.length && view.length ? (
        <div className="pg-wrap">
          <table className="pg" ref={tableRef}>
            <thead>
              <tr>
                <th className="pg-c">Customer</th>
                {cols.map((p) => <th key={p.id} title={p.name}><span className="pg-h">{p.name.replace(/,? \d+ ?lb drum$/i, "").replace(/ Resin \(B-Side\)/, "")}</span><span className="tiny faint">{p.sku} · {BASIS_LABEL[basisFor(p)]}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {view.map((c, r) => (
                <tr key={c.id}>
                  <th className="pg-c" scope="row"><Link href={`/customers/${c.id}/prices`}>{c.name}</Link><span className="tiny faint">{[c.account_no, c.rep].filter(Boolean).join(" · ")}</span></th>
                  {cols.map((p, ci) => {
                    const k = key(c.id, p.id); const e = edits.get(k);
                    return <Cell key={p.id} r={r} c={ci} value={valueOf(c.id, p.id)} dirty={!!e && isDirty(k, e)} imported={e?.from === "import"} onChange={onChange} onPaste={onPaste} onKey={onKey} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card small muted center">{cols.length ? "No customers match." : "No items in this group yet."}</div>}
      {pages > 1 ? (
        <div className="row center" style={{ gap: 10 }}>
          <button type="button" className="btn sm dark" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
          <span className="small">Customers {pg * PAGE + 1}–{Math.min(rows.length, pg * PAGE + PAGE)} of {rows.length}</span>
          <button type="button" className="btn sm dark" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
        </div>
      ) : null}
      {dirty.length ? (
        <div className="save-bar">
          <span className="small"><b>{dirty.length}</b> price{dirty.length === 1 ? "" : "s"} changed{dirty.some(([, e]) => e.from === "import") ? " (some from the import)" : ""}</span>
          <button type="button" className="btn sm ghost" onClick={() => { setEdits(new Map()); setReport(null); setMsg(null); }}><Undo2 size={15} /> Undo all</button>
          <button type="button" className="btn sm" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save prices"}</button>
        </div>
      ) : null}
    </div>
  );
}
