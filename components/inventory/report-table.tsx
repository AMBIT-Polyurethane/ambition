"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Filter, X } from "lucide-react";

// A report table you can sort (tap any column title) and filter by any column: a pick list for columns
// with a few values (Location, Group, Unit...), "contains" for text, and from / to for numbers.

type Cell = string | number | null;
type Sort = { col: number; dir: 1 | -1 } | null;
type Rule = { text?: string; pick?: string; min?: string; max?: string };

const isoDay = /(\d{4})-(\d{2})-(\d{2})/g;
const show = (v: Cell, money: boolean, cents = false) => {
  if (v === null || v === undefined || v === "") return "";
  // Money: whole dollars for big amounts, cents for prices under $1,000 (always cents on a price list).
  if (typeof v === "number") {
    if (!money) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const d = cents || (Math.abs(v) < 1000 && !Number.isInteger(v)) ? 2 : 0;
    return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
  }
  return v.replace(isoDay, (_, y: string, m: string, d: string) => `${Number(m)}/${Number(d)}/${y.slice(2)}`);
};
const plain = (v: Cell) => (v === null || v === undefined ? "" : String(v));
const numOf = (v: Cell) => (typeof v === "number" ? v : v !== null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

export function ReportTable({
  head,
  num,
  money,
  rows,
  flag,
  total,
  fileName,
  cents = false,
}: {
  head: string[];
  num: boolean[];
  money: boolean[];
  rows: Cell[][];
  flag: (boolean | "err")[];
  total?: Cell[];
  fileName: string;
  /** Money columns always show cents (a price list), never rounded to whole dollars. */
  cents?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Record<number, Rule>>({});
  const [sort, setSort] = useState<Sort>(null);
  const [q, setQ] = useState("");

  // Columns with a short list of values get a pick list.
  const choices = useMemo(
    () =>
      head.map((_, c) => {
        if (num[c]) return null;
        const set = new Set(rows.map((r) => plain(r[c])).filter(Boolean));
        return set.size > 0 && set.size <= 25 && set.size < rows.length ? [...set].sort((a, b) => a.localeCompare(b)) : null;
      }),
    [head, num, rows],
  );

  const active = Object.values(rules).filter((r) => r.text || r.pick || r.min || r.max).length + (q.trim() ? 1 : 0);

  const view = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let idx = rows.map((_, i) => i).filter((i) => {
      const r = rows[i];
      if (words.length) {
        const all = r.map((c) => `${plain(c)} ${show(c, false)}`).join(" ").toLowerCase();
        if (!words.every((w) => all.includes(w))) return false;
      }
      for (const [k, rule] of Object.entries(rules)) {
        const c = Number(k);
        const v = r[c];
        if (rule.pick && plain(v) !== rule.pick) return false;
        if (rule.text && !`${plain(v)} ${show(v, false)}`.toLowerCase().includes(rule.text.toLowerCase())) return false;
        if (rule.min || rule.max) {
          const x = numOf(v);
          if (x === null) return false;
          if (rule.min && x < Number(rule.min)) return false;
          if (rule.max && x > Number(rule.max)) return false;
        }
      }
      return true;
    });
    if (sort) {
      const { col, dir } = sort;
      idx = [...idx].sort((a, b) => {
        const x = rows[a][col];
        const y = rows[b][col];
        const nx = num[col] ? numOf(x) : null;
        const ny = num[col] ? numOf(y) : null;
        if (num[col]) {
          if (nx === null && ny === null) return 0;
          if (nx === null) return 1; // blanks / "no price" always last
          if (ny === null) return -1;
          return (nx - ny) * dir;
        }
        const sx = plain(x);
        const sy = plain(y);
        if (!sx && !sy) return 0;
        if (!sx) return 1;
        if (!sy) return -1;
        return sx.localeCompare(sy, undefined, { numeric: true }) * dir;
      });
    }
    return idx;
  }, [rows, rules, sort, q, num]);

  // Totals for what's showing (only the columns the report totals).
  const shownTotal = useMemo(() => {
    if (!total) return null;
    if (view.length === rows.length) return total;
    return total.map((t, c) => (c === 0 ? `Total (${view.length} shown)` : typeof t === "number" ? Math.round(view.reduce((s, i) => s + (numOf(rows[i][c]) ?? 0), 0) * 100) / 100 : ""));
  }, [total, view, rows]);

  const setRule = (c: number, patch: Partial<Rule>) => setRules((r) => ({ ...r, [c]: { ...r[c], ...patch } }));
  const clear = () => {
    setRules({});
    setQ("");
  };
  const tapHead = (c: number) => setSort((s) => (!s || s.col !== c ? { col: c, dir: num[c] ? -1 : 1 } : s.dir === (num[c] ? -1 : 1) ? { col: c, dir: (s.dir * -1) as 1 | -1 } : null));

  const download = () => {
    const esc = (v: Cell) => {
      const s = plain(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.map(esc).join(","), ...view.map((i) => rows[i].map(esc).join(","))];
    if (shownTotal) lines.push(shownTotal.map(esc).join(","));
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row rt-bar no-print" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="input sm rt-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every column" aria-label="Search every column" />
        <button type="button" className={`btn sm${open || active ? "" : " dark"}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Filter size={15} /> Filter{active ? ` (${active})` : ""}
        </button>
        {active || sort ? (
          <button type="button" className="btn sm ghost" onClick={() => { clear(); setSort(null); }}>
            <X size={15} /> Clear
          </button>
        ) : null}
        <button type="button" className="btn sm dark" onClick={download} title="Download what's showing, in this order">
          <Download size={15} /> {view.length === rows.length ? "Download" : `Download these ${view.length}`}
        </button>
        <span className="tiny faint">{view.length === rows.length ? `${rows.length} rows` : `${view.length} of ${rows.length} rows`}{sort ? ` · sorted by ${head[sort.col]}` : ""}</span>
      </div>

      {open ? (
        <section className="card rt-filters no-print">
          <div className="rt-grid">
            {head.map((h, c) => (
              <label key={c} className="field">
                <span className="label">{h}</span>
                {num[c] ? (
                  <span className="row" style={{ gap: 6 }}>
                    <input className="input sm" inputMode="decimal" placeholder="From" value={rules[c]?.min ?? ""} onChange={(e) => setRule(c, { min: e.target.value.replace(/[^0-9.-]/g, "") })} aria-label={`${h} from`} />
                    <input className="input sm" inputMode="decimal" placeholder="To" value={rules[c]?.max ?? ""} onChange={(e) => setRule(c, { max: e.target.value.replace(/[^0-9.-]/g, "") })} aria-label={`${h} to`} />
                  </span>
                ) : choices[c] ? (
                  <select className="select sm" value={rules[c]?.pick ?? ""} onChange={(e) => setRule(c, { pick: e.target.value })}>
                    <option value="">All</option>
                    {choices[c]!.map((v) => <option key={v} value={v}>{show(v, false)}</option>)}
                  </select>
                ) : (
                  <input className="input sm" placeholder="Contains…" value={rules[c]?.text ?? ""} onChange={(e) => setRule(c, { text: e.target.value })} />
                )}
              </label>
            ))}
            <label className="field">
              <span className="label">Sort by</span>
              <span className="row" style={{ gap: 6 }}>
                <select className="select sm" value={sort ? String(sort.col) : ""} onChange={(e) => setSort(e.target.value === "" ? null : { col: Number(e.target.value), dir: sort?.dir ?? (num[Number(e.target.value)] ? -1 : 1) })}>
                  <option value="">As listed</option>
                  {head.map((h, c) => <option key={c} value={c}>{h}</option>)}
                </select>
                <select className="select sm" value={sort ? String(sort.dir) : "1"} disabled={!sort} onChange={(e) => sort && setSort({ col: sort.col, dir: Number(e.target.value) as 1 | -1 })} aria-label="Direction">
                  <option value="1">A → Z / low → high</option>
                  <option value="-1">Z → A / high → low</option>
                </select>
              </span>
            </label>
          </div>
        </section>
      ) : null}

      {view.length ? (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                {head.map((h, c) => (
                  <th key={c} className={num[c] ? "num" : ""} aria-sort={sort?.col === c ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                    <button type="button" className={`rt-sort${sort?.col === c ? " on" : ""}`} onClick={() => tapHead(c)} title={`Sort by ${h}`}>
                      {h} {sort?.col === c ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} className="rt-idle" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((i) => (
                <tr key={i} className={flag[i] === "err" ? "err" : flag[i] ? "hl" : ""}>
                  {rows[i].map((c, ci) => <td key={ci} className={num[ci] ? "num" : ""}>{show(c, money[ci], cents)}</td>)}
                </tr>
              ))}
            </tbody>
            {shownTotal ? (
              <tfoot>
                <tr>{shownTotal.map((c, ci) => <td key={ci} className={num[ci] ? "num" : ""}>{show(c, money[ci], cents)}</td>)}</tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : (
        <div className="card small muted">Nothing matches. <button type="button" className="linklike" onClick={clear}>Clear the filters</button></div>
      )}
    </div>
  );
}
