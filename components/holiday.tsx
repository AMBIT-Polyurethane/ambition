"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarX2, X } from "lucide-react";
import type { Season } from "@/lib/holidays";

// The small holiday touches (0063): a seasonal card on Home (the greeting and the days AMBIT is closed) and, once a
// day on each phone or computer, a few seconds of falling leaves, snow or confetti. Admins turn them off in Admin >
// Holidays; people who ask their device for less motion never see anything move.

const ART: Record<Exclude<Season, null>, { colors: string[]; shape: "leaf" | "snow" | "confetti" | "star" | "heart"; bg: string; mark: string }> = {
  thanksgiving: { colors: ["#C2410C", "#D97706", "#B45309", "#DC2626", "#CA8A04"], shape: "leaf", bg: "linear-gradient(135deg, #7C2D12, #B45309 55%, #CA8A04)", mark: "🍂" },
  christmas: { colors: ["#FFFFFF", "#E0F2FE", "#F8FAFC"], shape: "snow", bg: "linear-gradient(135deg, #14532D, #166534 45%, #B91C1C)", mark: "❄" },
  newyear: { colors: ["#FACC15", "#E33527", "#FFFFFF", "#38BDF8", "#A78BFA"], shape: "confetti", bg: "linear-gradient(135deg, #0A0A0B, #1E1B4B 60%, #E33527)", mark: "✦" },
  july4: { colors: ["#E33527", "#FFFFFF", "#2563EB"], shape: "star", bg: "linear-gradient(135deg, #1E3A8A, #1D4ED8 50%, #E33527)", mark: "★" },
  halloween: { colors: ["#F97316", "#0A0A0B", "#7C3AED"], shape: "confetti", bg: "linear-gradient(135deg, #0A0A0B, #431407 55%, #F97316)", mark: "🎃" },
  valentines: { colors: ["#E33527", "#F472B6", "#FFFFFF"], shape: "heart", bg: "linear-gradient(135deg, #9F1239, #E11D48 55%, #F472B6)", mark: "♥" },
};

/** The seasonal card at the top of Home. */
export function HolidayCard({ season, greeting, name, closed, today }: { season: Season; greeting: string | null; name: string; closed: string | null; today: string }) {
  const key = `holiday-card:${today.slice(0, 7)}:${season}:${closed ?? ""}`;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === "1");
    } catch {}
  }, [key]);
  if (hidden || (!greeting && !closed)) return null;
  const art = season ? ART[season] : null;
  return (
    <section className="holiday-card" style={{ background: art?.bg ?? "linear-gradient(135deg, #0A0A0B, #3f3f46)" }}>
      <span className="holiday-mark" aria-hidden>{art?.mark ?? "✦"}</span>
      <div className="grow col" style={{ gap: 4, minWidth: 0 }}>
        {greeting ? <b className="holiday-hello">{greeting}, {name}</b> : null}
        {closed ? (
          <span className="holiday-closed">
            <CalendarX2 size={15} /> AMBIT is closed {closed}. Pickups and deliveries go on the next open day.
          </span>
        ) : null}
      </div>
      <button type="button" className="holiday-x" aria-label="Hide" onClick={() => { setHidden(true); try { localStorage.setItem(key, "1"); } catch {} }}>
        <X size={16} />
      </button>
    </section>
  );
}

/** A few seconds of falling leaves / snow / confetti, once a day on this device. */
export function Festive({ season, today }: { season: Season; today: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!season || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const k = `festive:${season}`;
    try {
      if (localStorage.getItem(k) === today) return;
      localStorage.setItem(k, today);
    } catch {}
    setOn(true);
    const t = setTimeout(() => setOn(false), 9000);
    return () => clearTimeout(t);
  }, [season, today]);
  const bits = useMemo(() => {
    if (!season) return [];
    const a = ART[season];
    return Array.from({ length: a.shape === "snow" ? 46 : 30 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 3.2,
      dur: 4.2 + Math.random() * 3.4,
      size: a.shape === "snow" ? 4 + Math.random() * 6 : 9 + Math.random() * 9,
      color: a.colors[i % a.colors.length],
      drift: (Math.random() - 0.5) * 140,
      spin: (Math.random() - 0.5) * 720,
    }));
  }, [season]);
  if (!on || !season) return null;
  const shape = ART[season].shape;
  return (
    <div className="festive" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          className={`festive-bit ${shape}`}
          style={{ left: `${b.left}%`, width: b.size, height: shape === "leaf" ? b.size * 0.62 : shape === "confetti" ? b.size * 0.45 : b.size, background: shape === "star" || shape === "heart" ? "none" : b.color, color: b.color, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, ["--drift" as string]: `${b.drift}px`, ["--spin" as string]: `${b.spin}deg`, fontSize: b.size }}
        >
          {shape === "star" ? "★" : shape === "heart" ? "♥" : null}
        </span>
      ))}
    </div>
  );
}

/** Warning next to a date picker when AMBIT is closed that day. */
export function ClosedWarning({ date, closures }: { date: string; closures: { date: string; name: string }[] }) {
  if (!date) return null;
  const c = closures.find((x) => x.date === date);
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  const why = c ? c.name : wd === 0 ? "a Sunday" : wd === 6 ? "a Saturday" : null;
  if (!why) return null;
  return (
    <span className="tiny warn-text" role="status">
      <CalendarX2 size={12} style={{ verticalAlign: -2 }} /> AMBIT is closed that day ({why}). Pick another day, or check with the location.
    </span>
  );
}

/** A date box (in a form) that warns when AMBIT is closed that day. */
export function ClosedDateInput({ name, defaultValue, min, closures, label = "Date" }: { name: string; defaultValue: string; min?: string; closures: { date: string; name: string }[]; label?: string }) {
  const [v, setV] = useState(defaultValue);
  return (
    <span className="col" style={{ gap: 4 }}>
      <input className="input sm" type="date" name={name} required min={min} value={v} onChange={(e) => setV(e.target.value)} aria-label={label} />
      <ClosedWarning date={v} closures={closures} />
    </span>
  );
}
