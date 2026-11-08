"use client";

import { useEffect, useId, useRef, useState } from "react";

// AMBIT-OPS Home charts. Plain SVG in the contractor's colors (--c1, --c2 from lib/ops/brand.ts), thin
// marks, rounded data ends, one axis, and a tooltip on hover or tap. Status colors stay status colors.

const money0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const short = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);

/** A small trend line for a KPI tile. Hover a point to see its value. */
export function Spark({ values, labels, color = "var(--c1)", format = short }: { values: number[]; labels?: string[]; color?: string; format?: (n: number) => string }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 160, H = 44, P = 4;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const x = (i: number) => P + (i * (W - P * 2)) / Math.max(1, values.length - 1);
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - P * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  const at = hover ?? last;
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Trend, latest ${format(values[last] ?? 0)}`}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.32" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d}L${x(last)},${H}L${x(0)},${H}Z`} fill={`url(#g${id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => (
          <rect key={i} x={x(i) - (W / values.length) / 2} y={0} width={W / values.length} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
      <span className="spark-dot" style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(values[at] ?? 0) / H) * 100}%`, background: color }} />
      {hover !== null ? (
        <span className="spark-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          {labels?.[hover] ? <i>{labels[hover]}</i> : null}
          {format(values[hover])}
        </span>
      ) : null}
    </div>
  );
}

export type MonthPoint = { m: string; revenue: number; cost: number; jobs: number };

/** Finished-job revenue each month, split into cost and gross profit (stacked, one dollar axis). */
export function ProfitBars({ data }: { data: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Drawn at the real width so the labels stay readable on a phone.
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 220 : 300, L = 44, B = 24, T = 10;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const bw = (W - L - 8) / data.length;
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const label = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" });
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="pbars" ref={box} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue and gross profit by month">
        {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="pb-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="pb-axis">{short(v)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + i * bw + bw * 0.18;
          const w = bw * 0.64;
          const profit = Math.max(0, d.revenue - d.cost);
          const yRev = y(d.revenue), yCost = y(Math.min(d.cost, d.revenue));
          const on = hover === i;
          return (
            <g key={d.m} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} className={hover !== null && !on ? "pb-dim" : ""}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {/* cost (bottom, quiet), a 2px gap, then profit (top, the brand color with a rounded end) */}
              <rect x={x} y={yCost} width={w} height={Math.max(0, y(0) - yCost)} rx="2" className="pb-cost" />
              {profit > 0 ? <path d={roundTop(x, yRev, w, Math.max(0, yCost - yRev - 2), 4)} className="pb-profit" /> : null}
              {bw >= 34 || i % 2 === data.length % 2 || on ? (
                <text x={x + w / 2} y={H - 6} textAnchor="middle" className={`pb-axis${on ? " on" : ""}`}>{bw < 34 ? label(d.m).slice(0, 1) : label(d.m)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {h && hover !== null ? (
        <div className="pb-tip" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%` }}>
          <b>{new Date(`${h.m}-15T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b>
          <span><i className="sw p" />Gross profit <b>{money0(h.revenue - h.cost)}</b></span>
          <span><i className="sw c" />Job cost <b>{money0(h.cost)}</b></span>
          <span className="faint">Revenue {money0(h.revenue)} · {h.jobs} job{h.jobs === 1 ? "" : "s"} · {h.revenue ? Math.round(((h.revenue - h.cost) / h.revenue) * 100) : 0}% margin</span>
        </div>
      ) : null}
    </div>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
function niceStep(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Yield against target as a ring: full ring = target. Over 100% shows a second lap in the accent color. */
export function YieldRing({ pct, label, sub, size = 132 }: { pct: number; label: string; sub: string; size?: number }) {
  const r = 52, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(pct, 130));
  const first = Math.min(p, 100) / 100;
  const over = Math.max(0, p - 100) / 100;
  const tone = pct >= 98 ? "ok" : pct >= 90 ? "warn" : "bad";
  return (
    <div className="yring" style={{ width: size }}>
      <svg viewBox="0 0 132 132" width={size} height={size} role="img" aria-label={`${label}: ${Math.round(pct)}% of target`}>
        <circle cx="66" cy="66" r={r} className="yr-track" />
        <circle cx="66" cy="66" r={r} className="yr-val" strokeDasharray={`${first * c} ${c}`} transform="rotate(-90 66 66)" />
        {over > 0 ? <circle cx="66" cy="66" r={r} className="yr-over" strokeDasharray={`${over * c} ${c}`} transform="rotate(-90 66 66)" /> : null}
      </svg>
      <span className="yr-mid">
        <b>{Math.round(pct)}%</b>
        <span className={`yr-tone ${tone}`}>{tone === "ok" ? "On target" : tone === "warn" ? "A little low" : "Low"}</span>
      </span>
      <span className="yr-label">{label}</span>
      <span className="tiny faint">{sub}</span>
    </div>
  );
}

/** One row of a horizontal bar list (pipeline stages, rigs, customers). */
export function HBar({ value, max, color = "var(--c1)" }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span className="hbar"><i style={{ width: `${w}%`, background: color }} /></span>
  );
}
