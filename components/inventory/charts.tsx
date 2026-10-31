"use client";

import { useState } from "react";

// Small charts for the Inventory Hub, drawn with plain HTML so the text stays sharp on a phone.
// Colors: --viz-1 / --viz-2 (validated for color-blind separation and contrast in dark and light).
// Every chart has a hover / tap tooltip and a "Show the numbers" table.

const compact = (v: number, money: boolean) => {
  const a = Math.abs(v);
  const trim = (x: string) => x.replace(/\.0$/, "");
  const s = a >= 1_000_000 ? `${trim((v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1))}M` : a >= 1000 ? `${trim((v / 1000).toFixed(a >= 100_000 ? 0 : 1))}k` : `${Math.round(v)}`;
  return money ? `$${s}` : s;
};
const full = (v: number, money: boolean) => (money ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** Nice round axis ticks from 0 up to the largest value. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) out.push(t);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

export type Series = { key: string; label: string };

/** Columns over time: one group per period, one bar per series (side by side, never stacked). */
export function ColumnChart({
  rows,
  series,
  money = true,
  caption,
}: {
  rows: { label: string; values: number[] }[];
  series: Series[];
  money?: boolean;
  caption: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...rows.flatMap((r) => r.values));
  const t = ticks(max);
  const top = t[t.length - 1] || 1;
  return (
    <figure className="viz">
      <figcaption className="sr-only">{caption}</figcaption>
      {series.length > 1 ? (
        <div className="viz-legend" aria-hidden>
          {series.map((s, i) => (
            <span key={s.key}>
              <i className={`viz-sw s${i + 1}`} /> {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="viz-col">
        <div className="viz-y" aria-hidden>
          {[...t].reverse().map((v) => (
            <span key={v} style={{ bottom: `${(v / top) * 100}%` }}>{compact(v, money)}</span>
          ))}
        </div>
        <div className="viz-plot" onMouseLeave={() => setHover(null)}>
          {t.map((v) => (
            <i key={v} className="viz-grid" style={{ bottom: `${(v / top) * 100}%` }} aria-hidden />
          ))}
          {rows.map((r, gi) => (
            <button
              type="button"
              key={r.label + gi}
              className={`viz-group${hover === gi ? " on" : ""}`}
              onMouseEnter={() => setHover(gi)}
              onFocus={() => setHover(gi)}
              onBlur={() => setHover(null)}
              onClick={() => setHover(hover === gi ? null : gi)}
              aria-label={`${r.label}: ${series.map((s, i) => `${s.label} ${full(r.values[i] ?? 0, money)}`).join(", ")}`}
            >
              <span className="viz-bars">
                {series.map((s, i) => (
                  <span key={s.key} className={`viz-bar s${i + 1}`} style={{ height: `${((r.values[i] ?? 0) / top) * 100}%` }} />
                ))}
              </span>
              {hover === gi ? (
                <span className={`viz-tip${gi > rows.length / 2 ? " left" : ""}`} role="tooltip">
                  <b>{r.label}</b>
                  {series.map((s, i) => (
                    <span key={s.key}>
                      <i className={`viz-sw s${i + 1}`} /> {s.label} <b>{full(r.values[i] ?? 0, money)}</b>
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="viz-x" aria-hidden>
        {rows.map((r, i) => (
          <span key={r.label + i}>{i % 2 === 0 || rows.length <= 7 ? r.label : ""}</span>
        ))}
      </div>
      <NumbersTable head={["", ...series.map((s) => s.label)]} rows={rows.map((r) => [r.label, ...r.values.map((v) => full(v, money))])} />
    </figure>
  );
}

/** Horizontal bars, one series: biggest first. */
export function BarList({
  rows,
  money = true,
  caption,
  sub,
}: {
  rows: { label: string; value: number; note?: string }[];
  money?: boolean;
  caption: string;
  sub?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...rows.map((r) => r.value)) || 1;
  return (
    <figure className="viz">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="viz-hbars">
        {rows.map((r, i) => (
          <button
            type="button"
            key={r.label + i}
            className={`viz-hrow${hover === i ? " on" : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${r.label}: ${full(r.value, money)}${r.note ? `, ${r.note}` : ""}`}
          >
            <span className="viz-hlabel">{r.label}</span>
            <span className="viz-htrack">
              <span className="viz-hbar s1" style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%` }} />
            </span>
            <span className="viz-hval">{compact(r.value, money)}</span>
            {hover === i && r.note ? <span className="viz-tip inline" role="tooltip">{r.note}</span> : null}
          </button>
        ))}
      </div>
      {sub ? <p className="tiny faint" style={{ margin: "6px 0 0" }}>{sub}</p> : null}
      <NumbersTable head={["", money ? "Value" : "Amount", ""]} rows={rows.map((r) => [r.label, full(r.value, money), r.note ?? ""])} />
    </figure>
  );
}

function NumbersTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="viz-table">
      <summary>Show the numbers</summary>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
