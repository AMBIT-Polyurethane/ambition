// The "Your apps" grid on the home screen: which apps each person gets, their colors, and their saved layout.

export type HomeApp = {
  key: string;
  label: string;
  href: string;
  external?: boolean;
  icon: string; // a name from components/icons
  color: string; // the tile color
  badge?: number;
};

/** A person's own layout (Profile → Edit apps): the order they picked and the apps they hid. */
export type HomeLayout = { order?: string[]; hidden?: string[] } | null | undefined;

// One strong color per kind of app, so the grid never blends together.
export const APP_COLOR = {
  red: "#E33527",
  slate: "#3A3F4B",
  orange: "#F97316",
  amber: "#E59A0B",
  blue: "#2563EB",
  teal: "#0D9488",
  violet: "#7C3AED",
  green: "#16A34A",
  pink: "#DB2777",
  indigo: "#4F46E5",
  cyan: "#0891B2",
  sky: "#0284C7",
  rose: "#E11D48",
  steel: "#5B6B82",
  fuchsia: "#C026D3",
  emerald: "#059669",
} as const;

/** Colors for apps that come from Admin → Links, picked by the link's icon. */
const LINK_COLORS: Record<string, string> = {
  calendar: APP_COLOR.cyan,
  plane: APP_COLOR.sky,
  alert: APP_COLOR.rose,
  clipboard: APP_COLOR.steel,
  tag: APP_COLOR.amber,
  megaphone: APP_COLOR.fuchsia,
  play: APP_COLOR.red,
  video: APP_COLOR.red,
  book: APP_COLOR.violet,
  headset: APP_COLOR.green,
  users: APP_COLOR.green,
  docs: APP_COLOR.teal,
  bulletin: APP_COLOR.blue,
  academy: APP_COLOR.violet,
  award: APP_COLOR.amber,
  pin: APP_COLOR.pink,
  phone: APP_COLOR.green,
  mail: APP_COLOR.sky,
  cart: APP_COLOR.red,
  building: APP_COLOR.indigo,
  wrench: APP_COLOR.orange,
  hammer: APP_COLOR.orange,
  shield: APP_COLOR.slate,
  box: APP_COLOR.orange,
  boxes: APP_COLOR.orange,
  drum: APP_COLOR.teal,
  layers: APP_COLOR.sky,
  card: APP_COLOR.indigo,
  form: APP_COLOR.indigo,
  droplet: APP_COLOR.steel,
  truck: APP_COLOR.orange,
  receipt: APP_COLOR.emerald,
  ruler: APP_COLOR.sky,
};

export const linkColor = (icon: string) => LINK_COLORS[icon] ?? APP_COLOR.slate;

/** Applies a saved layout: apps in the person's order (new apps keep their default spot at the end), hidden ones left out. */
export function arrangeApps(apps: HomeApp[], layout: HomeLayout, includeHidden = false): (HomeApp & { hidden: boolean })[] {
  const order = Array.isArray(layout?.order) ? layout!.order! : [];
  const hidden = new Set(Array.isArray(layout?.hidden) ? layout!.hidden! : []);
  const rank = new Map(order.map((k, i) => [k, i]));
  const sorted = apps
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (rank.get(x.a.key) ?? 1000 + x.i) - (rank.get(y.a.key) ?? 1000 + y.i))
    .map(({ a }) => ({ ...a, hidden: hidden.has(a.key) }));
  return includeHidden ? sorted : sorted.filter((a) => !a.hidden);
}

/** Reads a layout saved in the profile (anything unexpected is ignored). */
export function parseLayout(v: unknown): HomeLayout {
  if (!v || typeof v !== "object") return null;
  const o = v as { order?: unknown; hidden?: unknown };
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, 100) : []);
  return { order: strs(o.order), hidden: strs(o.hidden) };
}
