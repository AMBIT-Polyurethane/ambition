"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { CircleAlert, CircleCheck, FileUp } from "lucide-react";
import { money } from "@/lib/format";
import { importCredit, type ImportRow } from "@/app/(app)/credit/actions";

type Cust = { id: string; name: string; account_no: string | null };
type Col = "name" | "account" | "current" | "d1_30" | "d31_60" | "d61_90" | "over_90" | "balance" | "credit_limit" | "terms";
const COLS: [Col, RegExp][] = [
  ["credit_limit", /credit\s*limit/i],
  ["terms", /^terms$/i],
  ["current", /^current$/i],
  ["d1_30", /^1\s*-\s*30/i],
  ["d31_60", /^31\s*-\s*60/i],
  ["d61_90", /^61\s*-\s*90/i],
  ["over_90", /(^91|over\s*90|>\s*90|90\s*\+)/i],
  ["balance", /^(total|balance|open balance|amount due)$/i],
  ["account", /^(account|acct|account\s*#|account no|customer\s*#)/i],
  ["name", /^(customer|name|customer name|display name|customer full name)$/i],
];
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\b(llc|inc|co|corp|company|ltd|the)\b/g, "").replace(/[^a-z0-9]+/g, "");
const amt = (s: string) => {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};
const cell = (c: unknown) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));

type Parsed = { file: string; cols: Partial<Record<Col, number>>; rows: { raw: string; values: Partial<Record<Col, string>>; match: string }[] };

/** Reads a QuickBooks export (Excel or CSV), finds the columns, matches each line to a customer, and imports. */
export function CreditImporter({ customers }: { customers: Cust[] }) {
  const byName = useMemo(() => new Map(customers.map((c) => [norm(c.name), c.id])), [customers]);
  const byAcct = useMemo(() => new Map(customers.filter((c) => c.account_no).map((c) => [String(c.account_no).toLowerCase(), c.id])), [customers]);
  const [p, setP] = useState<Parsed | null>(null);
  const [asOf, setAsOf] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();

  async function read(file: File) {
    setMsg(null);
    let grid: string[][];
    if (/\.xlsx$/i.test(file.name)) {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: unknown[][] }[];
      grid = (sheets[0]?.data ?? []).map((r) => r.map(cell));
    } else {
      grid = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true }).data.map((r) => r.map(cell));
    }
    // The header row: the first one with at least two known columns.
    let head = -1;
    let cols: Partial<Record<Col, number>> = {};
    for (let i = 0; i < Math.min(grid.length, 25) && head < 0; i++) {
      const found: Partial<Record<Col, number>> = {};
      grid[i].forEach((h, j) => {
        const t = h.trim();
        const hit = COLS.find(([, re]) => re.test(t));
        if (hit && found[hit[0]] === undefined) found[hit[0]] = j;
      });
      if (Object.keys(found).length >= 2) { head = i; cols = found; }
    }
    if (head < 0) return setMsg({ ok: false, text: "Couldn't find the column titles (Current, 1 - 30, … Total, or Credit Limit). Is this the A/R Aging Summary or the Customer Contact List?" });
    if (cols.name === undefined) cols.name = 0;
    const rows = grid.slice(head + 1)
      .map((r) => {
        const values: Partial<Record<Col, string>> = {};
        for (const [k, j] of Object.entries(cols) as [Col, number][]) values[k] = r[j] ?? "";
        const raw = (values.name ?? "").trim();
        const acct = (values.account ?? "").trim().toLowerCase();
        const key = norm(raw.split(":")[0]);
        return { raw, values, match: (acct && byAcct.get(acct)) || byName.get(key) || "" };
      })
      .filter((r) => r.raw && !/^total/i.test(r.raw) && Object.entries(r.values).some(([k, v]) => k !== "name" && k !== "account" && String(v).trim() !== ""));
    setP({ file: file.name, cols, rows });
  }

  const has = (c: Col) => p?.cols[c] !== undefined;
  const matched = p?.rows.filter((r) => r.match) ?? [];
  const run = () =>
    go(async () => {
      if (!p) return;
      const rows: ImportRow[] = matched.map((r) => {
        const v = r.values;
        const o: ImportRow = { company_id: r.match };
        if (has("credit_limit")) o.credit_limit = amt(v.credit_limit ?? "");
        if (has("terms")) o.terms = (v.terms ?? "").trim();
        if (has("balance") || has("current")) {
          const parts = { current: amt(v.current ?? "") ?? 0, d1_30: amt(v.d1_30 ?? "") ?? 0, d31_60: amt(v.d31_60 ?? "") ?? 0, d61_90: amt(v.d61_90 ?? "") ?? 0, over_90: amt(v.over_90 ?? "") ?? 0 };
          Object.assign(o, has("current") ? parts : {});
          o.balance = amt(v.balance ?? "") ?? Object.values(parts).reduce((s, n) => s + n, 0);
        }
        return o;
      });
      const res = await importCredit(asOf, rows);
      setMsg(res.ok ? { ok: true, text: `Imported ${res.n} customers.${p.rows.length - matched.length ? ` ${p.rows.length - matched.length} lines weren't matched (pick the customer for them below, then import again).` : ""}` } : { ok: false, text: res.error });
    });

  return (
    <section className="col" style={{ gap: 12 }}>
      <div className="card col" style={{ gap: 10 }}>
        <label className="btn dark" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
          <FileUp size={16} /> Pick the QuickBooks file (.xlsx or .csv)
          <input type="file" accept=".xlsx,.csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        </label>
        <label className="field" style={{ maxWidth: 220 }}>
          <span className="label">Balances as of</span>
          <input className="input sm" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <span className="tiny faint">Payments entered in the app after this date come off these balances; orders shipped after it are added.</span>
      </div>
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`}>{msg.ok ? <CircleCheck size={18} style={{ flex: "none" }} /> : <CircleAlert size={18} style={{ flex: "none" }} />}<span>{msg.text}</span></div> : null}
      {p ? (
        <>
          <div className="row between wrap" style={{ gap: 8 }}>
            <span className="small"><b>{p.file}</b> · {p.rows.length} lines · <b>{matched.length}</b> matched to a customer · found: {(Object.keys(p.cols) as Col[]).filter((c) => c !== "name").join(", ") || "names only"}</span>
            <button type="button" className="btn" disabled={pending || !matched.length} onClick={run}>{pending ? "Importing…" : `Import ${matched.length} customers`}</button>
          </div>
          <div className="cr-wrap">
            <table className="cr-table">
              <thead><tr><th>In the file</th><th>Customer in the app</th>{has("credit_limit") ? <th>Credit line</th> : null}{has("balance") || has("current") ? <><th>Balance</th><th>Past due</th></> : null}</tr></thead>
              <tbody>
                {p.rows.map((r, i) => {
                  const pd = ["d1_30", "d31_60", "d61_90", "over_90"].reduce((s, k) => s + (amt(r.values[k as Col] ?? "") ?? 0), 0);
                  return (
                    <tr key={i}>
                      <td>{r.raw}</td>
                      <td style={{ textAlign: "left" }}>
                        <select className="select sm" value={r.match} onChange={(e) => setP((cur) => cur && { ...cur, rows: cur.rows.map((x, j) => (j === i ? { ...x, match: e.target.value } : x)) })} style={{ minWidth: 200, borderColor: r.match ? undefined : "var(--warn)" }}>
                          <option value="">Not matched: skip</option>
                          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.account_no ? ` (${c.account_no})` : ""}</option>)}
                        </select>
                      </td>
                      {has("credit_limit") ? <td>{amt(r.values.credit_limit ?? "") !== null ? money(amt(r.values.credit_limit ?? "")!) : "–"}</td> : null}
                      {has("balance") || has("current") ? <><td>{money(amt(r.values.balance ?? "") ?? 0)}</td><td className={pd ? "red" : "faint"}>{pd ? money(pd) : "–"}</td></> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
