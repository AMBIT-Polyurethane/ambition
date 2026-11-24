import { HEALTH, kmoney, type Health } from "@/lib/crm-shared";

// Small pieces the sales screens share (no state, safe on the server and in the browser).

/** The health tag on a customer. */
export function HealthPill({ status }: { status: Health }) {
  const h = HEALTH[status];
  return <span className={`pill ${h.pill}`} title={h.hint}>{h.label}</span>;
}

/** 12 tiny columns, oldest to this month: how a customer's buying moved this year. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0) || 1;
  return (
    <span className="crm-spark" role="img" aria-label={`${label}: ${values.map((v) => kmoney(v)).join(", ")}`}>
      {values.map((v, i) => (
        <i key={i} className={i === values.length - 1 ? "now" : undefined} style={{ height: `${v > 0 ? Math.max(8, (v / max) * 100) : 4}%`, opacity: v > 0 ? 1 : 0.35 }} />
      ))}
    </span>
  );
}

/** "+12%" / "-30%" against the 3 months before, colored by direction. */
export function Trend({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="faint">–</span>;
  if (!before) return <span className="crm-up">New</span>;
  const p = Math.round(((now - before) / before) * 100);
  return <span className={p >= 0 ? "crm-up" : p <= -40 ? "crm-down bad" : "crm-down"}>{p > 0 ? "+" : ""}{p}%</span>;
}
