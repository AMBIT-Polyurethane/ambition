"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { PERIODS, type PeriodKey } from "@/lib/expense-kinds";

// The expense dashboard's moving parts: the filters, the person x category heat map, and tables you can sort.
// Colors come from the chart tokens (--viz-1, validated for color-blind separation and contrast in both
// themes); every number is also in text, never color alone.

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 10_000) return `$${Math.round(v / 1000)}k`;
  if (a >= 1000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(v)}`;
};

export function DashFilters({ branches, people, from, to }: { branches: { id: string; name: string }[]; people: { id: string; name: string }[]; from: string; to: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const p = (sp.get("p") as PeriodKey) || "q";
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.push(`${path}?${q.toString()}`);
  };
  return (
    <div className="xd-filters">
      <select className="select sm" value={p} onChange={(e) => set({ p: e.target.value, from: e.target.value === "custom" ? from : null, to: e.target.value === "custom" ? to : null })} aria-label="Period">
        {PERIODS.map(([k, l]) => (
          <option key={k} value={k}>{l}</option>
        ))}
      </select>
      {p === "custom" ? (
        <>
          <input className="input sm" type="date" value={from} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
          <input className="input sm" type="date" value={to} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
        </>
      ) : null}
      <select className="select sm" value={sp.get("b") ?? ""} onChange={(e) => set({ b: e.target.value || null })} aria-label="Location">
        <option value="">All locations</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <select className="select sm" value={sp.get("u") ?? ""} onChange={(e) => set({ u: e.target.value || null })} aria-label="Person">
        <option value="">Everyone</option>
        {people.map((x) => (
          <option key={x.id} value={x.id}>{x.name}</option>
        ))}
      </select>
    </div>
  );
}

/** People down the side, categories across: the darker the cell, the more that person spent on it. */
export function Heatmap({ rows, cats, cells }: { rows: { key: string; name: string; total: number; href?: string }[]; cats: string[]; cells: Record<string, Record<string, { amount: number; n: number }>> }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => cats.map((c) => cells[r.key]?.[c]?.amount ?? 0)));
  return (
    <figure className="viz xd-heat">
      <figcaption className="sr-only">Spend per person and category</figcaption>
      <div className="tbl-wrap">
        <table className="xd-hm">
          <thead>
            <tr>
              <th />
              {cats.map((c) => (
                <th key={c} scope="col">
                  <span>{c}</span>
                </th>
              ))}
              <th scope="col" className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="ellipsis">
                  {r.href ? <Link href={r.href}>{r.name}</Link> : r.name}
                </th>
                {cats.map((c) => {
                  const v = cells[r.key]?.[c];
                  const a = v?.amount ?? 0;
                  const k = `${r.key}|${c}`;
                  const pct = a > 0 ? 8 + Math.round((a / max) * 52) : 0;
                  return (
                    <td
                      key={c}
                      tabIndex={a > 0 ? 0 : -1}
                      className={hover === k ? "on" : ""}
                      style={{ background: pct ? `color-mix(in srgb, var(--viz-1) ${pct}%, transparent)` : undefined }}
                      onMouseEnter={() => setHover(k)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(k)}
                      onBlur={() => setHover(null)}
                      aria-label={`${r.name}, ${c}: ${usd(a)}${v ? `, ${v.n} ${v.n === 1 ? "line" : "lines"}` : ""}`}
                    >
                      {a > 0 ? compact(a) : ""}
                      {hover === k && a > 0 ? (
                        <span className="viz-tip" role="tooltip">
                          <b>{r.name}</b>
                          <span>{c}: <b>{usd(a)}</b></span>
                          <span>{v?.n} {v?.n === 1 ? "receipt or charge" : "receipts and charges"} · {Math.round((a / (r.total || 1)) * 100)}% of their spend</span>
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td className="num">
                  <b>{compact(r.total)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="xd-scale" aria-hidden>
        <span>Less</span>
        <i />
        <span>More</span>
      </div>
    </figure>
  );
}

export type Col<T> = { key: string; label: string; num?: boolean; get: (r: T) => number | string | null; show?: (r: T) => React.ReactNode; title?: string };

/** A table you can sort by tapping a column. `hl` marks rows worth a look. */
export function SortTable<T>({ rows, cols, start, hl, empty, limit = 25 }: { rows: T[]; cols: Col<T>[]; start: string; hl?: (r: T) => boolean; empty: string; limit?: number }) {
  const [by, setBy] = useState(start);
  const [desc, setDesc] = useState(true);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.key === by) ?? cols[0];
    return [...rows].sort((a, b) => {
      const x = c.get(a);
      const y = c.get(b);
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
      return desc ? -d : d;
    });
  }, [rows, cols, by, desc]);
  if (!rows.length) return <div className="small muted">{empty}</div>;
  const shown = all ? sorted : sorted.slice(0, limit);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="tbl-wrap">
        <table className="tbl xd-tbl">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""} title={c.title}>
                  <button
                    type="button"
                    className={`rt-sort${by === c.key ? " on" : ""}`}
                    onClick={() => (by === c.key ? setDesc(!desc) : (setBy(c.key), setDesc(Boolean(c.num))))}
                  >
                    {c.label}
                    {by === c.key ? desc ? <ArrowDown size={11} /> : <ArrowUp size={11} /> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className={hl?.(r) ? "hl" : ""}>
                {cols.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>
                    {c.show ? c.show(r) : c.get(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <button type="button" className="linklike tiny" style={{ alignSelf: "flex-start" }} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}
