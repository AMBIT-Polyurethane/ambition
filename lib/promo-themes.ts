// The slides in the scrolling banner at the top of Home, and the color themes they can use.

export type PromoKind = "product" | "locations" | "custom";

export type PromoRow = {
  id: string;
  kind: PromoKind;
  product_id: string | null;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link: string | null;
  theme: string;
  audience: "all" | "employee" | "customer";
  sort: number;
  active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
};

/** One slide, ready to draw. */
export type PromoSlide = {
  id: string;
  kind: PromoKind;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  image: string | null;
  href: string;
  external: boolean;
  theme: string;
  /** Product slides: the price to show. */
  price?: { now: number | null; was: number | null; unit: string; sale: boolean; account: boolean };
  /** Map slide: the AMBIT locations. */
  cities?: string[];
};

export const PROMO_THEMES: Record<string, { label: string; bg: string; glow: string }> = {
  blue: { label: "Blue", bg: "linear-gradient(125deg, #0b2a8a 0%, #1d4ed8 45%, #2f7df6 100%)", glow: "rgba(125, 211, 252, 0.45)" },
  green: { label: "Green", bg: "linear-gradient(125deg, #04382c 0%, #047857 48%, #10b981 100%)", glow: "rgba(167, 243, 208, 0.5)" },
  red: { label: "Red", bg: "linear-gradient(125deg, #5a120c 0%, #c0261b 45%, #f0483a 100%)", glow: "rgba(255, 200, 180, 0.5)" },
  orange: { label: "Orange", bg: "linear-gradient(125deg, #7c2d12 0%, #ea580c 50%, #fb923c 100%)", glow: "rgba(254, 215, 170, 0.55)" },
  dark: { label: "Graphite", bg: "linear-gradient(125deg, #0b0d12 0%, #1f2430 55%, #3a4150 100%)", glow: "rgba(240, 72, 58, 0.55)" },
  violet: { label: "Violet", bg: "linear-gradient(125deg, #2e1065 0%, #6d28d9 50%, #a78bfa 100%)", glow: "rgba(221, 214, 254, 0.5)" },
  teal: { label: "Teal", bg: "linear-gradient(125deg, #083344 0%, #0e7490 50%, #22d3ee 100%)", glow: "rgba(165, 243, 252, 0.5)" },
};

export const themeOf = (t: string | null | undefined) => PROMO_THEMES[t ?? ""] ?? PROMO_THEMES.blue;
