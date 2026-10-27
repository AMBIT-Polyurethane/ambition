// The Home screen board (0029): every card on Home, in the order each person chose, minus the ones they hid.
// Saved on the profile as {"order": [...], "hidden": [...]}. Cards the app adds later slot in where they'd go by default.

export type HomeLayout = { order: string[]; hidden: string[] };

/**
 * Cards that run the full width of the board on a computer. None for now: a full-width card leaves gaps above it
 * in the shorter columns, and every card works at column width.
 */
export const WIDE_CARDS = new Set<string>([]);

export function parseHomeLayout(v: unknown): HomeLayout | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { order?: unknown; hidden?: unknown };
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === "string" && /^[a-z0-9-]{1,32}$/.test(k)).slice(0, 60) : []);
  return { order: list(r.order), hidden: list(r.hidden) };
}

/**
 * Put the cards this person has in their saved order. A card that isn't in the saved order (new, or a job change)
 * goes right after the card it follows by default.
 */
export function arrangeBoard(defaults: string[], saved: HomeLayout | null): HomeLayout {
  if (!saved || !saved.order.length) return { order: [...defaults], hidden: (saved?.hidden ?? []).filter((k) => defaults.includes(k)) };
  const have = new Set(defaults);
  const order = saved.order.filter((k, i, a) => have.has(k) && a.indexOf(k) === i);
  defaults.forEach((k, i) => {
    if (order.includes(k)) return;
    // after the nearest card before it (by default) that's already placed; else at the top
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = order.indexOf(defaults[j]);
      if (p >= 0) {
        at = p + 1;
        break;
      }
    }
    order.splice(at, 0, k);
  });
  return { order, hidden: saved.hidden.filter((k) => have.has(k)) };
}
