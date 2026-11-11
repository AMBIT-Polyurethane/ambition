// Date ranges for a person's sales list (Sales goals → a name). Days are Central-time calendar days, "YYYY-MM-DD".

export const RANGE_PRESETS = [
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last_year", label: "Last year" },
  { key: "12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "custom";
export type SalesRange = { key: RangeKey; from: string | null; to: string | null; label: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const validDay = (s: string | undefined | null): s is string => !!s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** "Oct 4, 2026", or "Oct 4" when the year is obvious. */
export function dayLabel(day: string, withYear = true): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** The range a link asks for (?r=last_month, or ?from=…&to=…), with "This month" when it asks for nothing usable. */
export function salesRange(sp: { r?: string; from?: string; to?: string }, today: string): SalesRange {
  const [y, m] = today.split("-").map(Number);
  const preset = (key: RangeKey): SalesRange => {
    const label = RANGE_PRESETS.find((p) => p.key === key)?.label ?? "This month";
    switch (key) {
      case "last_month":
        return { key, from: ymd(y, m - 1, 1), to: ymd(y, m, 0), label };
      case "quarter":
        return { key, from: ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today, label };
      case "ytd":
        return { key, from: ymd(y, 1, 1), to: today, label };
      case "last_year":
        return { key, from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31), label };
      case "12m": {
        const [, , d] = today.split("-").map(Number);
        return { key, from: ymd(y - 1, m, d + 1), to: today, label };
      }
      case "all":
        return { key, from: null, to: null, label };
      default:
        return { key: "month", from: ymd(y, m, 1), to: today, label: "This month" };
    }
  };
  if (validDay(sp.from) || validDay(sp.to)) {
    let from = validDay(sp.from) ? sp.from : null;
    let to = validDay(sp.to) ? sp.to : null;
    if (from && to && from > to) [from, to] = [to, from];
    const sameYear = from && to && from.slice(0, 4) === to.slice(0, 4);
    const label = from && to
      ? from === to
        ? dayLabel(from)
        : `${dayLabel(from, !sameYear)} – ${dayLabel(to)}`
      : from
        ? `Since ${dayLabel(from)}`
        : `Through ${dayLabel(to!)}`;
    return { key: "custom", from, to, label };
  }
  return preset((RANGE_PRESETS.some((p) => p.key === sp.r) ? sp.r : "month") as RangeKey);
}
