"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { CircleAlert, CircleCheck, FileUp } from "lucide-react";
import { money } from "@/lib/format";
import { importInvoices, type InvoiceRow } from "@/app/(app)/credit/actions";

// Credit › Import › Open invoices: the QuickBooks A/R Aging Detail (Excel or CSV) → every open invoice per customer.

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
  date: /^date$/i, type: /^(transaction type|type)$/i, num: /^(num|no\.?|number)$/i, customer: /^(customer full name|customer|name)$/i,
  location: /^(location full name|location)$/i, due: /^due date$/i, amount: /^amount$/i, open: /^open balance$/i,
};
type Col = keyof typeof COLS;

export function InvoiceImporter({ customers }: { customers: Cust[] }) {
  const byQb = useMemo(() => new Map(customers.filter((c) => c.qb_name).map((c) => [String(c.qb_name).toLowerCase(), c.id])), [customers]);
  const byName = useMemo(() => new Map(customers.map((c) => [norm(c.name), c.id])), [customers]);
  const [rows, setRows] = useState<(Omit<InvoiceRow, "company_id"> & { company_id: string })[] | null>(null);
  const [file, setFile] = useState("");
  const [asOf, setAsOf] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
  const [full, setFull] = useState(true);
  const [map, setMap] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();

  async function read(f: File) {
    setMsg(null); setMap({});
    let grid: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = (await readXlsxFile(f)) as unknown as { sheet: string; data: unknown[][] }[];
      grid = (sheets[0]?.data ?? []).map((r) => r.map(cell));
    } else grid = Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data.map((r) => r.map(cell));
    let head = -1; const cols: Partial<Record<Col, number>> = {};
    for (let i = 0; i < Math.min(grid.length, 30) && head < 0; i++) {
      const found: Partial<Record<Col, number>> = {};
      grid[i].forEach((h, j) => { const k = (Object.keys(COLS) as Col[]).find((c) => COLS[c].test(h.trim())); if (k && found[k] === undefined) found[k] = j; });
      if (found.open !== undefined && found.customer !== undefined && found.date !== undefined) { head = i; Object.assign(cols, found); }
    }
    if (head < 0) return setMsg({ ok: false, text: "Couldn't find the columns. Export Reports › A/R Aging Detail (it needs Date, Transaction type, Num, Customer, Due date, Amount and Open balance)." });
    const out = grid.slice(head + 1).map((r) => {
      const g = (k: Col) => (cols[k] === undefined ? "" : String(r[cols[k]!] ?? ""));
      const qb = g("customer").trim();
      return { company_id: byQb.get(qb.toLowerCase()) || byName.get(norm(qb.split(":").pop() ?? "")) || byName.get(norm(qb)) || "", qb_name: qb, kind: g("type").trim() || "Invoice",
        doc_no: g("num").trim(), txn_date: iso(g("date")), due_date: iso(g("due")), amount: amt(g("amount")), open: amt(g("open")), location: g("location").trim() };
    }).filter((r) => r.qb_name && r.txn_date && Number.isFinite(r.open));
    setFile(f.name);
    setRows(out);
  }

  const unmatched = useMemo(() => [...new Set((rows ?? []).filter((r) => !r.company_id).map((r) => r.qb_name))], [rows]);
  const ready = (rows ?? []).map((r) => ({ ...r, company_id: r.company_id || map[r.qb_name] || "" })).filter((r) => r.company_id);
  const total = ready.reduce((s, r) => s + r.open, 0);

  return (
    <section className="card col" style={{ gap: 12 }}>
      <b>Open invoices (A/R Aging Detail)</b>
      <label className="btn sm dark" style={{ alignSelf: "flex-start" }}>
        <FileUp size={15} /> {file ? `Picked ${file}` : "Pick the A/R Aging Detail file"}
        <input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {rows ? (
        <>
          <div className="grid2">
            <label className="field"><span className="label">The report is as of</span><input className="input sm" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
            <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> It&apos;s every open invoice (close anything not in it: paid in QuickBooks)</label>
          </div>
          <span className="small">{rows.length} lines · {ready.length} matched to {new Set(ready.map((r) => r.company_id)).size} customers · {money(total)} open</span>
          {unmatched.length ? (
            <div className="col" style={{ gap: 6 }}>
              <span className="small warn-text"><b>{unmatched.length} customer{unmatched.length === 1 ? "" : "s"} not found in the app.</b> Pick each one (or leave it out):</span>
              {unmatched.slice(0, 60).map((n) => (
                <label key={n} className="row" style={{ gap: 8 }}>
                  <span className="small grow ellipsis" title={n}>{n}</span>
                  <select className="select sm" style={{ width: 260 }} value={map[n] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [n]: e.target.value }))}>
                    <option value="">— leave out —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          <button type="button" className="btn" disabled={pending || !ready.length} onClick={() => go(async () => {
            const r = await importInvoices(asOf, ready, full);
            setMsg(r.ok ? { ok: true, text: `Imported ${r.rows} open lines for ${r.customers} customers. ${r.closed} older invoices were paid in QuickBooks and closed.` } : { ok: false, text: r.error });
          })}>{pending ? "Importing…" : `Import ${ready.length} open lines`}</button>
        </>
      ) : null}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`}>{msg.ok ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<span>{msg.text}</span></div> : null}
    </section>
  );
}
