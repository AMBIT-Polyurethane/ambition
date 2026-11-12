// Holidays (0063): the dates (worked out for any year), the days AMBIT is closed, and the seasonal touches the app
// shows around them. Used by the server and the screens. Settings: app_settings "holidays" (Admin > Holidays).

export type HolidayKey =
  | "new-years-day" | "mlk-day" | "valentines" | "presidents-day" | "easter" | "memorial-day" | "july-4" | "labor-day"
  | "halloween" | "veterans-day" | "thanksgiving" | "black-friday" | "christmas-eve" | "christmas" | "new-years-eve";
export type Holiday = { key: HolidayKey; name: string; date: string; closable: boolean };
export type HolidaySettings = { touches: boolean; closed: string[]; extra: { date: string; name: string }[] };
export const DEFAULT_HOLIDAYS: HolidaySettings = {
  touches: true,
  closed: ["new-years-day", "memorial-day", "july-4", "labor-day", "thanksgiving", "black-friday", "christmas-eve", "christmas"],
  extra: [],
};
export const readHolidaySettings = (v: unknown): HolidaySettings => {
  const o = (v ?? {}) as Partial<HolidaySettings>;
  return {
    touches: o.touches !== false,
    closed: Array.isArray(o.closed) ? o.closed.filter((x): x is string => typeof x === "string") : DEFAULT_HOLIDAYS.closed,
    extra: Array.isArray(o.extra) ? o.extra.filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date)).map((x) => ({ date: x.date, name: String(x.name ?? "Closed").slice(0, 60) })) : [],
  };
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
/** The nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nth(y: number, m: number, wd: number, n: number) {
  if (n > 0) {
    const first = dow(y, m, 1);
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = dow(y, m, days);
  return days - ((last - wd + 7) % 7);
}
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}
/** A fixed-date closure on a weekend is taken Friday (Saturday) or Monday (Sunday). */
function observed(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.getUTCDay();
  if (wd === 6) d.setUTCDate(d.getUTCDate() - 1);
  if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export const addDaysIso = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function holidaysFor(y: number): Holiday[] {
  const tg = nth(y, 11, 4, 4);
  return [
    { key: "new-years-day", name: "New Year's Day", date: iso(y, 1, 1), closable: true },
    { key: "mlk-day", name: "Martin Luther King Jr. Day", date: iso(y, 1, nth(y, 1, 1, 3)), closable: true },
    { key: "valentines", name: "Valentine's Day", date: iso(y, 2, 14), closable: false },
    { key: "presidents-day", name: "Presidents' Day", date: iso(y, 2, nth(y, 2, 1, 3)), closable: true },
    { key: "easter", name: "Easter", date: easter(y), closable: false },
    { key: "memorial-day", name: "Memorial Day", date: iso(y, 5, nth(y, 5, 1, -1)), closable: true },
    { key: "july-4", name: "Independence Day", date: iso(y, 7, 4), closable: true },
    { key: "labor-day", name: "Labor Day", date: iso(y, 9, nth(y, 9, 1, 1)), closable: true },
    { key: "halloween", name: "Halloween", date: iso(y, 10, 31), closable: false },
    { key: "veterans-day", name: "Veterans Day", date: iso(y, 11, 11), closable: true },
    { key: "thanksgiving", name: "Thanksgiving", date: iso(y, 11, tg), closable: true },
    { key: "black-friday", name: "Day after Thanksgiving", date: iso(y, 11, tg + 1), closable: true },
    { key: "christmas-eve", name: "Christmas Eve", date: iso(y, 12, 24), closable: true },
    { key: "christmas", name: "Christmas Day", date: iso(y, 12, 25), closable: true },
    { key: "new-years-eve", name: "New Year's Eve", date: iso(y, 12, 31), closable: true },
  ];
}

const FIXED = new Set<HolidayKey>(["new-years-day", "july-4", "christmas", "veterans-day"]);
/** The days AMBIT is closed in a year (with the weekend rule for fixed dates), plus any extra days admins added. */
export function closedDays(y: number, s: HolidaySettings): { date: string; name: string }[] {
  const out = holidaysFor(y)
    .filter((h) => h.closable && s.closed.includes(h.key))
    .map((h) => ({ date: FIXED.has(h.key) ? observed(h.date) : h.date, name: h.name }));
  // Christmas on a Saturday is taken Friday the 24th: Christmas Eve moves to Thursday.
  const xmas = out.find((c) => c.name === "Christmas Day");
  const eve = out.find((c) => c.name === "Christmas Eve");
  if (xmas && eve && xmas.date === eve.date) eve.date = addDaysIso(eve.date, -1);
  for (const e of s.extra) if (e.date.startsWith(String(y))) out.push(e);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
/** Closed days from a date through the next few months (crosses into next year). */
export function closuresAround(today: string, s: HolidaySettings) {
  const y = Number(today.slice(0, 4));
  return [...closedDays(y, s), ...closedDays(y + 1, s)].filter((c) => c.date >= addDaysIso(today, -1));
}
/** Is AMBIT closed that day (a closure, or a weekend)? */
export function closedOn(date: string, closures: { date: string; name: string }[]): string | null {
  const c = closures.find((x) => x.date === date);
  if (c) return c.name;
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return wd === 0 ? "Sunday" : wd === 6 ? "Saturday" : null;
}

export type Season = "thanksgiving" | "christmas" | "newyear" | "july4" | "halloween" | "valentines" | null;
/** The seasonal touch for a day (decorations and colors around the holiday). */
export function seasonOn(date: string): Season {
  const y = Number(date.slice(0, 4));
  const md = date.slice(5);
  const tg = holidaysFor(y).find((h) => h.key === "thanksgiving")!.date;
  if (date >= iso(y, 11, 1) && date <= tg) return "thanksgiving";
  if (date > tg && md <= "12-26") return "christmas";
  if (md >= "12-27" || md <= "01-02") return "newyear";
  if (md >= "06-28" && md <= "07-05") return "july4";
  if (md >= "10-25" && md <= "10-31") return "halloween";
  if (md >= "02-10" && md <= "02-14") return "valentines";
  return null;
}

/** The greeting for a day ("Happy Thanksgiving", "Merry Christmas", ...), or null. */
export function greetingOn(date: string): string | null {
  const s = seasonOn(date);
  const y = Number(date.slice(0, 4));
  const hs = holidaysFor(y);
  const at = (k: HolidayKey) => hs.find((h) => h.key === k)!.date;
  if (s === "thanksgiving") return date === at("thanksgiving") ? "Happy Thanksgiving" : date >= addDaysIso(at("thanksgiving"), -6) ? "Happy Thanksgiving week" : null;
  if (s === "christmas") return date >= iso(y, 12, 20) ? "Merry Christmas" : "Happy holidays";
  if (s === "newyear") return "Happy New Year";
  if (s === "july4") return "Happy Fourth of July";
  if (s === "halloween") return date === at("halloween") ? "Happy Halloween" : null;
  if (s === "valentines") return date === at("valentines") ? "Happy Valentine's Day" : null;
  return null;
}

/** Group closures that fall on back-to-back days ("Thu, Nov 26 and Fri, Nov 27 for Thanksgiving"). */
export function closureText(list: { date: string; name: string }[]) {
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (!list.length) return "";
  if (list.length === 1) return `${fmt(list[0].date)} (${list[0].name})`;
  const names = [...new Set(list.map((c) => c.name))];
  const main = names.filter((n) => !names.some((m) => n === `Day after ${m}`));
  return `${list.map((c) => fmt(c.date)).join(" and ")} (${main.join(", ")})`;
}
