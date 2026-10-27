"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent as RPointerEvent, type FocusEvent as RFocusEvent } from "react";
import { CircleAlert, Clock, OctagonAlert } from "lucide-react";
import { STAGES } from "@/lib/order-desk";
import { orderNo } from "@/lib/format";
import type { OrderStage } from "@/lib/types";
import { RANGES, type DeskStats, type RangeKey, type StepKey } from "@/lib/desk-stats";

// The top of the Order Desk: how many orders sit in each status, how many come in, where they wait.
// Charts are plain HTML/SVG. Every mark has a hover/focus tooltip, and every chart has its numbers in a table.

/** Open statuses in pipeline order; each keeps its color wherever it appears. */
export const OPEN_STAGES: OrderStage[] = ["customer", "needs_po", "credit", "hold", "schedule", "scheduled"];
const SLOT: Record<string, number> = { customer: 1, needs_po: 2, credit: 3, hold: 4, schedule: 5, scheduled: 6 };
const color = (s: OrderStage) => `var(--dc${SLOT[s] ?? 1})`;

const STEPS: { key: StepKey; label: string; who: string }[] = [
  { key: "customer", label: "Customer approval", who: "Contractor approves the emailed order" },
  { key: "po", label: "Sales Order #", who: "CRM enters the Sales Order #" },
  { key: "credit", label: "Credit check", who: "Credit approvals releases or holds it" },
  { key: "schedule", label: "Scheduling", who: "CRM sets the pickup or delivery date" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const md = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const dow = (iso: string) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const n0 = (v: number | null | undefined) => Number(v ?? 0);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** 0.6 -> "35 min", 5.2 -> "5.2 hrs", 70 -> "2.9 days" */
export function duration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return "–";
  const h = Number(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} hrs`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}

/** A bar's length, leaving room at the end of the track for its value label. */
const barWidth = (frac: number, label = 40) => `calc(${(frac * 100).toFixed(2)}% - ${(frac * label).toFixed(1)}px)`;

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

type Tip = { x: number; y: number; value: string; label: string } | null;

export function DeskDashboard({
  stats,
  range,
  branch,
  tab,
  branches,
}: {
  stats: DeskStats;
  range: RangeKey;
  branch: string | null;
  tab: string | null;
  branches: { id: string; name: string }[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);

  const href = (p: { r?: string; b?: string | null; tab?: string | null }) => {
    const q = new URLSearchParams();
    const r = p.r ?? range;
    const b = p.b === undefined ? branch : p.b;
    const t = p.tab === undefined ? tab : p.tab;
    if (r !== "30") q.set("r", r);
    if (b) q.set("b", b);
    if (t) q.set("tab", t);
    const s = q.toString();
    return `/orders/desk${s ? `?${s}` : ""}`;
  };
  const rangeLabel = range === "year" ? "This year" : `Last ${range} days`;
  const branchName = (id: string) => (id === "dropship" ? "Drop ship" : branches.find((b) => b.id === id)?.name ?? id.toUpperCase());

  // ---- hover / focus tooltip (one for the whole dashboard)
  const show = (el: Element | null, x?: number, y?: number) => {
    const mark = el?.closest<HTMLElement | SVGElement>("[data-tip]");
    const box = root.current?.getBoundingClientRect();
    if (!mark || !box) return setTip(null);
    const [value, label] = (mark.getAttribute("data-tip") ?? "").split("|");
    if (x === undefined || y === undefined) {
      const r = mark.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top;
    }
    // keep the tooltip inside the dashboard
    const left = Math.min(Math.max(x - box.left, 110), Math.max(110, box.width - 110));
    setTip({ x: left, y: y - box.top, value, label: label ?? "" });
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => show(e.target as Element, e.clientX, e.clientY);
  const onFocus = (e: RFocusEvent<HTMLDivElement>) => show(e.target as Element);

  // ---- numbers
  const open = OPEN_STAGES.map((s) => ({ stage: s, n: n0(stats.open[s]) }));
  const totalOpen = open.reduce((a, b) => a + b.n, 0);
  const series = stats.series ?? [];
  const seriesMax = niceMax(Math.max(0, ...series.map((s) => s.n)));
  const locIds = [...new Set(stats.by_branch.map((r) => r.branch))].sort((a, b) => {
    const order = [...branches.map((x) => x.id), "dropship"];
    return order.indexOf(a) - order.indexOf(b);
  });
  const loc = locIds.map((id) => {
    const parts = OPEN_STAGES.map((s) => ({ stage: s, n: stats.by_branch.find((r) => r.branch === id && r.stage === s)?.n ?? 0 })).filter((p) => p.n > 0);
    return { id, parts, total: parts.reduce((a, b) => a + b.n, 0) };
  });
  const locMax = Math.max(1, ...loc.map((l) => l.total));
  const stepRows = STEPS.map((s) => ({ ...s, agg: stats.steps[s.key] ?? null }));
  const stepMax = Math.max(1, ...stepRows.map((s) => n0(s.agg?.median)));
  const labelEvery = Math.max(1, Math.ceil(series.length / (stats.bucket === "day" ? 7 : 8)));

  return (
    <div className="dash" ref={root} onPointerMove={onMove} onPointerLeave={() => setTip(null)} onFocusCapture={onFocus} onBlurCapture={() => setTip(null)}>
      {/* ---- filters: scope everything below, including the order lists */}
      <div className="dash-filters">
        <div className="chips" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <Link key={r.key} href={href({ r: r.key })} className={`chip sm${range === r.key ? " on" : ""}`} scroll={false}>
              {r.label}
            </Link>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Location">
          <Link href={href({ b: null })} className={`chip sm${!branch ? " on2" : ""}`} scroll={false}>All locations</Link>
          {[...branches, { id: "dropship", name: "Drop ship" }].map((b) => (
            <Link key={b.id} href={href({ b: b.id })} className={`chip sm${branch === b.id ? " on2" : ""}`} scroll={false}>
              {b.name}
            </Link>
          ))}
        </div>
      </div>

      {/* ---- the numbers at a glance */}
      <div className="dash-tiles">
        <div className="dash-tile big">
          <span className="l">Open orders right now</span>
          <span className="v">{totalOpen.toLocaleString("en-US")}</span>
          <span className="s">{branch ? branchName(branch) : "All locations"}</span>
        </div>
        <a className={`dash-tile${stats.stuck ? " warn" : ""}`} href="#waiting">
          <span className="l">Waiting over a day</span>
          <span className="v">
            {stats.stuck ? <CircleAlert size={20} aria-hidden="true" /> : null}
            {stats.stuck.toLocaleString("en-US")}
          </span>
          <span className="s">{stats.stuck ? "See who's waiting longest" : "Nothing stuck"}</span>
        </a>
        <div className="dash-tile">
          <span className="l">Orders placed</span>
          <span className="v">{stats.placed.toLocaleString("en-US")}</span>
          <span className="s">{rangeLabel}</span>
        </div>
        <div className="dash-tile">
          <span className="l">Picked up or delivered</span>
          <span className="v">{stats.completed.toLocaleString("en-US")}</span>
          <span className="s">{rangeLabel}{stats.cancelled ? ` · ${stats.cancelled} cancelled` : ""}</span>
        </div>
        <div className="dash-tile">
          <span className="l">Typical order time</span>
          <span className="v">{stats.cycle?.n ? duration(stats.cycle.median) : "–"}</span>
          <span className="s">{stats.cycle?.n ? `Placed to done · ${plural(stats.cycle.n, "order", "orders")}` : "No orders finished yet"}</span>
        </div>
      </div>

      <div className="dash-grid">
        {/* ---- open orders by status */}
        <section className="dash-card">
          <div>
            <h3>Open orders by status</h3>
            <div className="sub">Right now · tap a status to see its orders</div>
          </div>
          {totalOpen === 0 ? (
            <p className="dash-empty">No open orders{branch ? ` for ${branchName(branch)}` : ""}.</p>
          ) : (
            <div className="ddonut-wrap">
              <Donut parts={open} total={totalOpen} href={(s) => href({ tab: s })} />
              <ul className="dash-legend">
                {open.map((p) => (
                  <li key={p.stage}>
                    <Link href={href({ tab: p.stage })} scroll={false} className={tab === p.stage ? "on" : ""}>
                      <i style={{ background: color(p.stage) }} />
                      <span className="nm">{STAGES[p.stage].short}</span>
                      <b>{p.n}</b>
                      <span className="pc">{p.n ? `${Math.round((p.n / totalOpen) * 100)}%` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Numbers head={["Status", "Orders"]} rows={open.map((p) => [STAGES[p.stage].label, String(p.n)])} />
        </section>

        {/* ---- orders placed over time */}
        <section className="dash-card">
          <div>
            <h3>Orders placed per {stats.bucket}</h3>
            <div className="sub">{rangeLabel} · {plural(stats.placed, "order", "orders")}</div>
          </div>
          <div className="dcols" role="img" aria-label={`Orders placed per ${stats.bucket}, ${rangeLabel.toLowerCase()}`}>
            <div className="dcols-grid" aria-hidden="true">
              {[seriesMax, seriesMax / 2, 0].map((t) => (
                <div key={t} className="gl">
                  <span>{Number.isInteger(t) ? t : t.toFixed(1)}</span>
                </div>
              ))}
            </div>
            <div className="dcols-plot">
              {series.map((s, i) => (
                <div
                  key={s.d}
                  className="dcol"
                  tabIndex={0}
                  data-tip={`${plural(s.n, "order", "orders")}|${stats.bucket === "week" ? `Week of ${md(s.d)}` : `${dow(s.d)}, ${md(s.d)}`}`}
                >
                  <div className="bar" style={{ height: `${(s.n / seriesMax) * 100}%` }} />
                  <span className="xl">{i % labelEvery === 0 ? md(s.d) : ""}</span>
                </div>
              ))}
            </div>
          </div>
          <Numbers head={[stats.bucket === "week" ? "Week of" : "Day", "Orders placed"]} rows={series.filter((s) => s.n > 0).map((s) => [md(s.d), String(s.n)])} empty="No orders in this range." />
        </section>

        {/* ---- open orders by location */}
        <section className="dash-card">
          <div>
            <h3>Open orders by location</h3>
            <div className="sub">Right now, split by status</div>
          </div>
          {loc.length === 0 ? (
            <p className="dash-empty">No open orders.</p>
          ) : (
            <>
              <div className="dhbars">
                {loc.map((l) => (
                  <div key={l.id} className="dhbar">
                    <span className="hl">{branchName(l.id)}</span>
                    <div className="track">
                      <div className="fill" style={{ width: barWidth(l.total / locMax) }}>
                        {l.parts.map((p) => (
                          <span
                            key={p.stage}
                            className="dseg"
                            tabIndex={0}
                            style={{ flexGrow: p.n, background: color(p.stage) }}
                            data-tip={`${plural(p.n, "order", "orders")}|${branchName(l.id)} · ${STAGES[p.stage].short}`}
                          />
                        ))}
                      </div>
                      <b className="tot">{l.total}</b>
                    </div>
                  </div>
                ))}
              </div>
              <ul className="dash-legend inline">
                {OPEN_STAGES.filter((s) => loc.some((l) => l.parts.some((p) => p.stage === s))).map((s) => (
                  <li key={s}>
                    <i style={{ background: color(s) }} />
                    <span className="nm">{STAGES[s].short}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Numbers
            head={["Location", ...OPEN_STAGES.map((s) => STAGES[s].short), "Total"]}
            rows={loc.map((l) => [branchName(l.id), ...OPEN_STAGES.map((s) => String(l.parts.find((p) => p.stage === s)?.n ?? 0)), String(l.total)])}
            empty="No open orders."
          />
        </section>

        {/* ---- where orders wait */}
        <section className="dash-card" id="waiting">
          <div>
            <h3>Where orders get stuck</h3>
            <div className="sub">Typical time each step takes · {rangeLabel.toLowerCase()}</div>
          </div>
          <div className="dhbars steps">
            {stepRows.map((s) => (
              <div key={s.key} className="dhbar">
                <span className="hl">{s.label}</span>
                <div className="track">
                  {s.agg?.n ? (
                    <>
                      <div
                        className="fill one"
                        tabIndex={0}
                        style={{ width: barWidth(Math.max(0.02, n0(s.agg.median) / stepMax), 64) }}
                        data-tip={`${duration(s.agg.median)} typical|${s.who} · ${plural(s.agg.n, "order", "orders")}, average ${duration(s.agg.avg)}`}
                      />
                      <b className="tot">{duration(s.agg.median)}</b>
                    </>
                  ) : (
                    <span className="none">No orders yet</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="dwait">
            <div className="eyebrow">Waiting longest</div>
            {stats.waiting.length === 0 ? (
              <p className="dash-empty">Nothing waiting.</p>
            ) : (
              <ul>
                {stats.waiting.map((w) => {
                  const level = w.late || w.hours >= 72 ? "crit" : w.hours >= 24 ? "warn" : "ok";
                  return (
                    <li key={w.id}>
                      <Link href={`/orders/${w.id}`}>
                        <span className="who">
                          <b>{orderNo(w.order_no)}</b> {w.company}
                        </span>
                        <span className="what">
                          <i style={{ background: color(w.stage) }} />
                          {w.late ? "Past its pickup / delivery date" : STAGES[w.stage].short}
                          {w.branch ? ` · ${branchName(w.branch)}` : ""}
                        </span>
                        <span className={`age ${level}`}>
                          {level === "crit" ? <OctagonAlert size={14} aria-hidden="true" /> : level === "warn" ? <Clock size={14} aria-hidden="true" /> : null}
                          {duration(w.hours)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Numbers
            head={["Step", "Typical", "Average", "Orders"]}
            rows={stepRows.map((s) => [s.label, s.agg?.n ? duration(s.agg.median) : "–", s.agg?.n ? duration(s.agg.avg) : "–", String(s.agg?.n ?? 0)])}
          />
        </section>
      </div>

      {tip ? (
        <div className="dash-tip" role="status" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.value}</b>
          {tip.label ? <span>{tip.label}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Part of the whole: a donut with a 2px gap between slices. */
function Donut({ parts, total, href }: { parts: { stage: OrderStage; n: number }[]; total: number; href: (s: OrderStage) => string }) {
  const r = 60;
  const c = 2 * Math.PI * r;
  const gap = parts.filter((p) => p.n > 0).length > 1 ? 2.5 : 0;
  let at = 0;
  return (
    <svg className="ddonut" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label={`${total} open orders by status`}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="var(--line)" strokeWidth="1" opacity="0" />
      {parts.map((p) => {
        if (!p.n) return null;
        const len = (p.n / total) * c;
        const seg = (
          <a key={p.stage} href={href(p.stage)} tabIndex={0} data-tip={`${p.n} ${p.n === 1 ? "order" : "orders"} · ${Math.round((p.n / total) * 100)}%|${STAGES[p.stage].label}`}>
            <circle
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={color(p.stage)}
              strokeWidth="24"
              strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`}
              strokeDashoffset={-at}
              transform="rotate(-90 80 80)"
            />
          </a>
        );
        at += len;
        return seg;
      })}
      <text x="80" y="78" textAnchor="middle" className="dn-v">{total}</text>
      <text x="80" y="98" textAnchor="middle" className="dn-l">open</text>
    </svg>
  );
}

/** Every chart's numbers, for anyone who'd rather read a table. */
function Numbers({ head, rows, empty }: { head: string[]; rows: string[][]; empty?: string }) {
  return (
    <details className="dash-nums">
      <summary>Show the numbers</summary>
      {rows.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="dash-empty">{empty ?? "Nothing yet."}</p>
      )}
    </details>
  );
}
