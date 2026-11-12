import { money } from "@/lib/format";

// The A/R aging as one bar: Current (gray), then 1-30, 31-60, 61-90 and 90+ days late in deepening red.
// Every part is labeled with its amount and share, so it never relies on color alone.

export const BUCKETS = [
  { key: "current_due", label: "Current", cls: "a0" },
  { key: "d1_30", label: "1–30 days", cls: "a1" },
  { key: "d31_60", label: "31–60", cls: "a2" },
  { key: "d61_90", label: "61–90", cls: "a3" },
  { key: "over_90", label: "90+", cls: "a4" },
] as const;
export type Aging = Record<(typeof BUCKETS)[number]["key"], number>;

export function AgingBar({ a, compact = false }: { a: Aging; compact?: boolean }) {
  const total = BUCKETS.reduce((s, b) => s + Math.max(0, a[b.key]), 0);
  if (total <= 0) return <div className="tiny muted">No open balance.</div>;
  return (
    <figure className="aging" style={{ margin: 0 }}>
      <figcaption className="sr-only">A/R aging: {BUCKETS.map((b) => `${b.label} ${money(a[b.key])}`).join(", ")}</figcaption>
      <div className="aging-bar" aria-hidden="true">
        {BUCKETS.map((b) => (a[b.key] > 0 ? <span key={b.key} className={`aging-seg ${b.cls}`} style={{ flexGrow: a[b.key] }} data-tip={`${b.label}|${money(a[b.key])} · ${Math.round((a[b.key] / total) * 100)}%`} title={`${b.label}: ${money(a[b.key])}`} /> : null))}
      </div>
      {compact ? null : (
        <div className="aging-legend">
          {BUCKETS.map((b) => (
            <span key={b.key} className="aging-key">
              <i className={`aging-sw ${b.cls}`} />
              <span className="tiny muted">{b.label}</span>
              <b className="small">{money(a[b.key])}</b>
              <span className="tiny faint">{total ? `${Math.round((a[b.key] / total) * 100)}%` : ""}</span>
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
