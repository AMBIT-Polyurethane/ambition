"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownToLine, OctagonAlert, PackageCheck, Truck } from "lucide-react";
import type { CalDay, CalItem } from "@/lib/widgets";

const KIND: Record<CalItem["kind"], { label: string; many: string; icon: typeof Truck; slot: number }> = {
  pickup: { label: "Pickup", many: "pickups", icon: PackageCheck, slot: 1 },
  delivery: { label: "Delivery", many: "deliveries", icon: Truck, slot: 2 },
  incoming: { label: "Incoming", many: "incoming", icon: ArrowDownToLine, slot: 3 },
};
const ORDER: CalItem["kind"][] = ["pickup", "delivery", "incoming"];

/** The week ahead at a glance: tap a day to see what's going out and coming in. */
export function WeekCalendar({ days, addHref }: { days: CalDay[]; addHref?: string }) {
  const [sel, setSel] = useState(0);
  const day = days[sel];
  const dow = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const dom = (d: string) => Number(d.slice(8, 10));
  return (
    <div className="wcal">
      <div className="wcal-days" role="tablist" aria-label="Days">
        {days.map((d, i) => {
          const counts = ORDER.map((k) => d.items.filter((x) => x.kind === k).length);
          const late = d.items.some((x) => x.late);
          return (
            <button
              key={d.day}
              type="button"
              role="tab"
              aria-selected={i === sel}
              aria-label={`${i === 0 ? "Today" : dow(d.day)} ${dom(d.day)}: ${d.items.length ? ORDER.map((k, j) => (counts[j] ? `${counts[j]} ${counts[j] === 1 ? KIND[k].label.toLowerCase() : KIND[k].many}` : "")).filter(Boolean).join(", ") : "nothing"}`}
              className={`wcal-day${i === sel ? " on" : ""}${late ? " late" : ""}`}
              onClick={() => setSel(i)}
            >
              <span className="dw">{i === 0 ? "Today" : dow(d.day)}</span>
              <span className="dn">{dom(d.day)}</span>
              <span className="dots" aria-hidden="true">
                {ORDER.map((k, j) => (counts[j] ? <i key={k} style={{ background: `var(--wc${KIND[k].slot})` }} /> : null))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="wcal-legend" aria-hidden="true">
        {ORDER.map((k) => (
          <span key={k}><i style={{ background: `var(--wc${KIND[k].slot})` }} />{KIND[k].label}</span>
        ))}
      </div>
      <ul className="wcal-list" role="tabpanel">
        {day.items.length === 0 ? (
          <li className="empty small muted">Nothing scheduled{sel === 0 ? " today" : ""}.</li>
        ) : (
          day.items.map((x) => {
            const K = KIND[x.kind];
            const I = x.late ? OctagonAlert : K.icon;
            return (
              <li key={`${x.kind}-${x.id}`}>
                <Link href={x.href} className={x.late ? "late" : ""}>
                  <span className="ic" style={{ ["--c" as string]: `var(--wc${K.slot})` }}><I size={15} aria-hidden="true" /></span>
                  <span className="wcal-txt">
                    <b className="ellipsis">{x.title}</b>
                    <span className="tiny faint ellipsis">{x.late ? "Late · " : ""}{K.label} · {x.sub}</span>
                  </span>
                </Link>
              </li>
            );
          })
        )}
      </ul>
      {addHref ? <Link href={addHref} className="linkbtn small">+ Expected delivery</Link> : null}
    </div>
  );
}
