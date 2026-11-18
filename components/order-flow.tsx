import Link from "next/link";
import { FileText, PenLine, Printer } from "lucide-react";
import { LANES, type FlowEdge, type FlowModel, type FlowStep } from "@/lib/order-flow";

// The order's Flow view: a chart of every step, in lanes by who does it, with the step that's up now in red.
// iPad / desktop: the chart. Phone: the same steps as a list.

const LW = 248;
const NW = 200;
const NH = 72;
const TOP = 56;
const PITCH = 112;
const W = LW * LANES.length;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const box = (s: FlowStep) => {
  const x = s.lane * LW + 24;
  const y = TOP + s.row * PITCH;
  return { x, y, cx: x + NW / 2, cy: y + NH / 2 };
};

function edgePath(e: FlowEdge, a: FlowStep, b: FlowStep): { d: string; lx?: number; ly?: number; anchor?: "start" | "middle" | "end" } {
  const p = box(a);
  const q = box(b);
  switch (e.route) {
    case "down":
      return { d: `M ${p.cx} ${p.y + NH} V ${q.y - 3}` };
    case "back":
      return { d: `M ${p.cx + 60} ${p.y} V ${q.y + NH + 3}`, lx: p.cx + 68, ly: (p.y + q.y + NH) / 2 + 4, anchor: "start" };
    case "hold":
      return { d: `M ${p.cx - 40} ${p.y + NH} V ${q.y - 3}`, lx: p.cx - 48, ly: (p.y + NH + q.y) / 2 + 4, anchor: "end" };
    case "release":
      return { d: `M ${p.cx + 40} ${p.y} V ${q.y + NH + 3}`, lx: p.cx + 48, ly: (p.y + q.y + NH) / 2 + 4, anchor: "start" };
    case "admin":
      return { d: `M ${p.cx} ${p.y + NH} V ${q.cy} H ${q.x + NW + 3}`, lx: (q.x + NW + p.cx) / 2, ly: q.cy - 10, anchor: "middle" };
    case "elbow":
    default:
      return b.lane > a.lane ? { d: `M ${p.x + NW} ${p.cy} H ${q.cx} V ${q.y - 3}` } : { d: `M ${p.x} ${p.cy} H ${q.cx} V ${q.y - 3}` };
  }
}

function tone(a: FlowStep, b: FlowStep, e: FlowEdge): "done" | "now" | "next" {
  // The side paths (changes asked for, credit hold) only light up while they're happening.
  if (e.route === "back" || e.route === "hold" || e.route === "release") return b.state === "now" || a.state === "now" ? "now" : "next";
  if (b.state === "now" && a.state === "done") return "now";
  if (a.state === "done" && b.state === "done") return "done";
  return "next";
}

function Mark({ s, x, y }: { s: FlowStep; x: number; y: number }) {
  if (s.state === "done")
    return (
      <g className={s.warn ? "fl-ic warn" : "fl-ic done"}>
        <circle cx={x} cy={y} r={9} />
        <path d={`M ${x - 4} ${y} l 3 3 l 5 -6`} />
      </g>
    );
  if (s.state === "now")
    return (
      <g className="fl-ic now">
        <circle cx={x} cy={y} r={9} />
        <circle cx={x} cy={y} r={4} className="dot" />
      </g>
    );
  return (
    <g className="fl-ic next">
      <circle cx={x} cy={y} r={9} />
    </g>
  );
}

function Chart({ m }: { m: FlowModel }) {
  const by = new Map(m.steps.map((s) => [s.key, s]));
  const rows = Math.max(...m.steps.map((s) => s.row)) + 1;
  const H = TOP + rows * PITCH;
  return (
    <svg className="flow-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The order's steps, by who does each one">
      <defs>
        {(["done", "now", "next"] as const).map((t) => (
          <marker key={t} id={`fl-a-${t}`} className={`fl-m ${t}`} orient="auto" markerWidth="6" markerHeight="6" refX="3" refY="3" overflow="visible">
            <path d="M0 0 L6 3 L0 6 Z" />
          </marker>
        ))}
      </defs>
      {LANES.map((name, i) => (
        <g key={name}>
          <rect x={i * LW} y={0} width={LW} height={H} className={`fl-lane${i % 2 ? " alt" : ""}${m.lane === i ? " up" : ""}`} />
          <text x={i * LW + 16} y={30} className={`fl-lh${m.lane === i ? " up" : ""}`}>
            {name.toUpperCase()}
            {m.lane === i ? " · UP NOW" : ""}
          </text>
        </g>
      ))}
      <text x={4 * LW + LW / 2} y={TOP + 2 * PITCH - 12} className="fl-note" textAnchor="middle">any time before loading</text>
      {m.edges.map((e) => {
        const a = by.get(e.from);
        const b = by.get(e.to);
        if (!a || !b) return null;
        const t = tone(a, b, e);
        const { d, lx, ly, anchor } = edgePath(e, a, b);
        return (
          <g key={`${e.from}-${e.to}`}>
            <path d={d} className={`fl-e ${t}${e.style === "dashed" ? " dashed" : ""}`} markerEnd={`url(#fl-a-${t})`} />
            {e.label && lx !== undefined ? <text x={lx} y={ly} textAnchor={anchor} className={`fl-el${t === "done" && e.route === "admin" ? " done" : ""}`}>{e.label}</text> : null}
          </g>
        );
      })}
      {m.steps.map((s) => {
        const p = box(s);
        return (
          <g key={s.key} className={`fl-n ${s.state}${s.warn ? " warn" : ""}`}>
            <title>{`${s.title}: ${s.sub}`}</title>
            <rect x={p.x} y={p.y} width={NW} height={NH} rx={12} />
            <Mark s={s} x={p.x + 22} y={p.cy} />
            <text x={p.x + 40} y={p.cy - 4} className="t">{cut(s.title, 21)}</text>
            <text x={p.x + 40} y={p.cy + 15} className="s">{cut(s.sub, 26)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function List({ m }: { m: FlowModel }) {
  const by = new Map(m.steps.map((s) => [s.key, s]));
  const changed = by.get("changed");
  const order = ["placed", "approve", "so", "credit", "hold", "date", ...(changed && changed.state !== "skip" ? ["changed", "admin"] : []), "pick", "sign", "out"];
  return (
    <ol className="flow-list">
      {order.map((k) => {
        const s = by.get(k);
        if (!s) return null;
        return (
          <li key={k} className={`fl-li ${s.state}${s.warn ? " warn" : ""}`}>
            <span className="fl-dot" aria-hidden="true" />
            <div className="col tight" style={{ minWidth: 0 }}>
              <span className="fl-who">{LANES[s.lane].toUpperCase()}{s.state === "now" ? " · UP NOW" : ""}</span>
              <b className="small">{s.title}</b>
              <span className="tiny faint">{s.sub}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderFlow({ m }: { m: FlowModel }) {
  const pct = m.stepNo ? Math.round(((m.stepNo - 1) / m.total) * 100) : m.finished ? 100 : 0;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="flow-progress">
        <b className="small nowrap">{m.cancelled ? "Cancelled" : m.finished ? "Done" : m.stepNo ? `Step ${m.stepNo} of ${m.total}` : ""}</b>
        <div className="flow-bar"><div style={{ width: `${pct}%` }} className={m.finished ? "done" : ""} /></div>
        <div className="flow-legend tiny">
          <span><i className="done" />Done</span>
          <span><i className="now" />Now</span>
          <span><i className="next" />Up next or not needed</span>
        </div>
      </div>
      {m.cancelled ? <div className="alert err small"><span>{m.cancelled}</span></div> : null}
      {m.finished ? <div className="alert ok small"><span><b>{m.finished}.</b> Every step is done.</span></div> : null}
      {m.upNow ? (
        <section className="flow-up">
          <div className="col tight" style={{ minWidth: 0, gap: 4 }}>
            <span className="fl-up-who">UP NOW · {m.upNow.team.toUpperCase()}</span>
            <b>{m.upNow.text}</b>
            {m.upNow.lines.length ? (
              <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {m.upNow.lines.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            ) : null}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {m.upNow.actions.map((a) => {
              const Icon = a.icon === "print" ? Printer : a.icon === "pen" ? PenLine : FileText;
              const cls = `btn sm${a.primary ? "" : " dark"}`;
              return a.blank ? (
                <a key={a.href} href={a.href} target="_blank" rel="noopener" className={cls}><Icon size={16} /> {a.label}</a>
              ) : (
                <Link key={a.href + a.label} href={a.href} className={cls}><Icon size={16} /> {a.label}</Link>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className="flow-wide"><Chart m={m} /></div>
      <div className="flow-narrow"><List m={m} /></div>
    </div>
  );
}
