"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import { CircleAlert, CircleCheck, FileUp, LoaderCircle } from "lucide-react";
import { money } from "@/lib/format";
import { importFinished, importHistory, type HistoryRow } from "@/app/(app)/sales/actions";

// Sales > Import: QuickBooks "Sales by Customer Detail" (Excel or CSV) → every sale line, matched to A.I. customers.
// QuickBooks groups the lines under each customer's name (a heading row, then "Total for …"); a Customer column works too.

type Cust = { id: string; name: string; qb_name: string | null };
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\b(llc|inc|co|corp|company|ltd|the|dba)\b/g, "").replace(/[^a-z0-9]+/g, "");
const cell = (c: unknown) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));
const amt = (s: string) => {
  const t = s.trim();
  if (!t) return NaN;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[^\d.]/g, ""));
  return neg ? -n : n;
};
const iso = (s: string) => {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
const COLS = {
  date: /^(date|transaction date)$/i,
  type: /^(transaction type|type)$/i,
  num: /^(num|no\.?|number)$/i,
  customer: /^(customer|customer full name|customer name|name)$/i,
  item: /^(product\/service|product\/service full name|product\/service name|item|product)$/i,
  qty: /^(qty|quantity)$/i,
  amount: /^amount$/i,
};
type Col = keyof typeof COLS;
const CHUNK = 1500;

export function HistoryImport({ customers }: { customers: Cust[] }) {
  const byQb = useMemo(() => new Map(customers.filter((c) => c.qb_name).map((c) => [String(c.qb_name).toLowerCase(), c.id])), [customers]);
  const byName = useMemo(() => new Map(customers.map((c) => [norm(c.name), c.id])), [customers]);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [file, setFile] = useState("");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [map, setMap] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function read(f: File) {
    setMsg(null);
    setMap({});
    let grid: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = (await readXlsxFile(f)) as unknown as { sheet: string; data: unknown[][] }[];
      grid = (sheets[0]?.data ?? []).map((r) => r.map(cell));
    } else grid = Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data.map((r) => r.map(cell));
    let head = -1;
    const cols: Partial<Record<Col, number>> = {};
    for (let i = 0; i < Math.min(grid.length, 40) && head < 0; i++) {
      const found: Partial<Record<Col, number>> = {};
      grid[i].forEach((h, j) => {
        const k = (Object.keys(COLS) as Col[]).find((c) => COLS[c].test(h.trim()));
        if (k && found[k] === undefined) found[k] = j;
      });
      if (found.date !== undefined && found.amount !== undefined && (found.item !== undefined || found.type !== undefined)) {
        head = i;
        Object.assign(cols, found);
      }
    }
    if (head < 0) return setMsg({ ok: false, text: "Couldn't find the columns. In QuickBooks run Reports › Sales by Customer Detail and export it to Excel (it needs Date, Transaction type, Num, Product/Service and Amount)." });
    // The report's own date range, from the title rows ("January 1, 2025 - November 24, 2026"), if it's there.
    const title = grid.slice(0, head).flat().join(" ");
    const range = /([A-Z][a-z]+ \d{1,2}, \d{4})\s*[-–]\s*([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(title);
    const ymd = (s: string) => new Date(`${s} 12:00`).toLocaleDateString("en-CA");
    let group = "";
    const out: HistoryRow[] = [];
    for (const r of grid.slice(head + 1)) {
      const g = (k: Col) => (cols[k] === undefined ? "" : String(r[cols[k]!] ?? "")).trim();
      const day = iso(g("date"));
      if (!day) {
        // A customer heading ("Hartley Spray Foam") or its total ("Total for Hartley Spray Foam").
        const first = r.map((x) => String(x ?? "").trim()).find(Boolean) ?? "";
        if (first && !/^total\b/i.test(first) && r.filter((x) => String(x ?? "").trim()).length === 1) group = first;
        continue;
      }
      const qb = g("customer") || group;
      const a = amt(g("amount"));
      if (!qb || !Number.isFinite(a)) continue;
      const short = qb.split(":").pop() ?? qb;
      out.push({
        company_id: byQb.get(qb.toLowerCase()) || byName.get(norm(short)) || byName.get(norm(qb)) || null,
        qb_name: qb,
        txn_date: day,
        txn_type: g("type") || "Invoice",
        doc_no: g("num"),
        item: g("item"),
        qty: g("qty") ? Number(g("qty").replace(/[^\d.-]/g, "")) : null,
        amount: a,
      });
    }
    const days = out.map((r) => r.txn_date).sort();
    setFrom(range ? ymd(range[1]) : days[0] ?? "");
    setThrough(range ? ymd(range[2]) : days[days.length - 1] ?? "");
    setFile(f.name);
    setRows(out);
  }

  const unmatched = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (!r.company_id) m.set(r.qb_name, (m.get(r.qb_name) ?? 0) + r.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const ready = (rows ?? []).map((r) => ({ ...r, company_id: r.company_id || map[r.qb_name] || null }));
  const matched = ready.filter((r) => r.company_id);
  const total = ready.reduce((s, r) => s + r.amount, 0);

  async function load() {
    if (!ready.length) return;
    setMsg(null);
    let n = 0;
    for (let i = 0; i < ready.length; i += CHUNK) {
      setBusy(`Loading ${Math.min(i + CHUNK, ready.length).toLocaleString()} of ${ready.length.toLocaleString()} lines…`);
      const r = await importHistory(ready.slice(i, i + CHUNK), i === 0, from, through);
      if (!r.ok) {
        setBusy(null);
        return setMsg({ ok: false, text: `${r.error}${i ? ` (stopped after ${n.toLocaleString()} lines; import the file again to redo it)` : ""}` });
      }
      n += r.n;
    }
    await importFinished();
    setBusy(null);
    setMsg({ ok: true, text: `Loaded ${n.toLocaleString()} sale lines from ${from} to ${through}. The sales hub and dashboard use them now (lines for customers not in A.I. are kept and can be matched later).` });
  }

  return (
    <section className="card col" style={{ gap: 12 }}>
      <b>Sales by Customer Detail</b>
      <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>In QuickBooks: <b>Reports</b> › search <b>Sales by Customer Detail</b>.</li>
        <li>Set the dates (for example January 1, 2025 to today) and click <b>Run report</b>.</li>
        <li>Click the <b>Export</b> button (the arrow at the top right) › <b>Export to Excel</b>.</li>
        <li>Pick that file here.</li>
      </ol>
      <label className="btn sm dark" style={{ alignSelf: "flex-start" }}>
        <FileUp size={15} /> {file ? `Picked ${file}` : "Pick the Sales by Customer Detail file"}
        <input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {rows ? (
        <>
          <div className="grid2">
            <label className="field"><span className="label">From</span><input className="input sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span className="label">Through</span><input className="input sm" type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></label>
          </div>
          <span className="small">
            {rows.length.toLocaleString()} lines · {money(total)} · {matched.length.toLocaleString()} lines matched to {new Set(matched.map((r) => r.company_id)).size} customers. Anything already loaded for these dates is replaced.
          </span>
          {unmatched.length ? (
            <details className="col" style={{ gap: 6 }}>
              <summary className="small warn-text"><b>{unmatched.length} QuickBooks customer{unmatched.length === 1 ? "" : "s"} not found in A.I.</b> Pick the ones you want matched (the rest still load, unmatched).</summary>
              {unmatched.slice(0, 80).map(([n, v]) => (
                <label key={n} className="row" style={{ gap: 8 }}>
                  <span className="small grow ellipsis" title={n}>{n} <span className="faint">{money(v)}</span></span>
                  <select className="select sm" style={{ width: 260 }} value={map[n] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [n]: e.target.value }))}>
                    <option value="">Not matched</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              ))}
            </details>
          ) : null}
          <button type="button" className="btn" disabled={!!busy || !ready.length || !from || !through} onClick={load} style={{ gap: 8 }}>
            {busy ? <LoaderCircle size={16} className="spin" /> : null} {busy ?? `Load ${ready.length.toLocaleString()} sale lines`}
          </button>
        </>
      ) : null}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`}>{msg.ok ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<span>{msg.text}</span></div> : null}
    </section>
  );
}
