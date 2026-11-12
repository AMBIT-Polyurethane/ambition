"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarRange, ChevronDown } from "lucide-react";
import { RANGE_PRESETS, type RangeKey } from "@/lib/sales-range";

/**
 * The date filter on a person's sales list: a button showing the current range that opens quick picks (This month,
 * Last month, …) and a From / To pair for any other dates. Everything is in the link, so a range can be shared.
 */
export function RangeFilter({ base, current, label, from, to, today, keep, title = "Show sales from", start = "month" }: {
  base: string; // the page's path, e.g. /sales-goals/<id>
  current: RangeKey;
  label: string;
  from: string | null;
  to: string | null;
  today: string;
  /** Other things in the link to keep when the dates change (a report's location: { b: "okc" }). */
  keep?: Record<string, string>;
  /** The words over the quick picks. */
  title?: string;
  /** The range a bare link means (the page's default). */
  start?: RangeKey;
}) {
  const kept = Object.entries(keep ?? {}).filter(([, v]) => v);
  const link = (r: string) => {
    const q = new URLSearchParams([...(r === start ? [] : [["r", r]]), ...kept]);
    return q.size ? `${base}?${q}` : base;
  };
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away, { passive: true });
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="range-pick" ref={box}>
      <button
        type="button"
        className={`btn sm dark range-btn${current !== start ? " on" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarRange size={16} aria-hidden="true" />
        <span className="ellipsis">{label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="range-menu" role="dialog" aria-label="Choose the dates">
          <span className="tiny faint range-title">{title}</span>
          <div className="range-presets">
            {RANGE_PRESETS.map((p) => (
              <Link
                key={p.key}
                href={link(p.key)}
                className={`chip sm${current === p.key ? " on" : ""}`}
                onClick={() => setOpen(false)}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <form action={base} method="get" className="range-custom">
            {kept.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="field">
              <span className="label">From</span>
              <input className="input sm" type="date" name="from" defaultValue={current === "custom" ? from ?? "" : ""} max={today} />
            </label>
            <label className="field">
              <span className="label">To</span>
              <input className="input sm" type="date" name="to" defaultValue={current === "custom" ? to ?? "" : ""} max={today} />
            </label>
            <button type="submit" className="btn sm dark">Apply</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
