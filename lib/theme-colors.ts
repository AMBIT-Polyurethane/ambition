// Each person's dashboard colors (0065): an accent color from the color wheel (or a preset like Blush or
// Lavender) and, if they like, a soft background tinted with it. Logos, layout and type stay AMBIT. Used by the
// server (the app layout writes the CSS) and by the Colors picker on Profile (live preview).

export type UserColors = { accent: string; soft: boolean; preset?: string | null };

export const AMBIT_RED = "#E33527";
export const PRESETS: { key: string; name: string; accent: string; soft: boolean }[] = [
  { key: "ambit", name: "AMBIT", accent: AMBIT_RED, soft: false },
  { key: "blush", name: "Blush", accent: "#E0457B", soft: true },
  { key: "lavender", name: "Lavender", accent: "#7C5CE6", soft: true },
  { key: "ocean", name: "Ocean", accent: "#1D7FC4", soft: true },
  { key: "sage", name: "Sage", accent: "#3F8F67", soft: true },
  { key: "sunset", name: "Sunset", accent: "#EA7A2B", soft: true },
  { key: "teal", name: "Teal", accent: "#0F9488", soft: true },
  { key: "slate", name: "Slate", accent: "#4B5B73", soft: false },
];

const HEX = /^#([0-9a-f]{6})$/i;
export function readColors(v: unknown): UserColors | null {
  const o = (v ?? null) as Partial<UserColors> | null;
  if (!o || typeof o.accent !== "string" || !HEX.test(o.accent)) return null;
  if (o.accent.toUpperCase() === AMBIT_RED && !o.soft) return null; // the AMBIT default: nothing to change
  return { accent: o.accent.toUpperCase(), soft: Boolean(o.soft), preset: typeof o.preset === "string" ? o.preset.slice(0, 20) : null };
}

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c: RGB) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
/** a mixed into b: t = how much of a (0..1). */
const mix = (a: string, b: string, t: number) => {
  const x = rgb(a), y = rgb(b);
  return hex([x[0] * t + y[0] * (1 - t), x[1] * t + y[1] * (1 - t), x[2] * t + y[2] * (1 - t)]);
};
const rgba = (a: string, alpha: number) => `rgba(${rgb(a).join(", ")}, ${alpha})`;
/** Relative brightness (0 dark .. 1 light). */
const luma = (a: string) => {
  const [r, g, b] = rgb(a).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** A color the wheel can give that's too light to read on white gets darkened a little (and too dark, lightened). */
function usable(accent: string, on: "light" | "dark") {
  const l = luma(accent);
  if (on === "light" && l > 0.62) return mix(accent, "#000000", 0.62 / l);
  if (on === "dark" && l < 0.18) return mix(accent, "#ffffff", 0.7);
  return accent;
}

function vars(c: UserColors, mode: "light" | "dark"): string {
  const a = usable(c.accent, mode);
  const v: Record<string, string> =
    mode === "light"
      ? { "--red": a, "--red-hot": mix(a, "#000000", 0.86), "--red-soft": rgba(a, 0.12), "--red-text": mix(a, "#000000", 0.8) }
      : { "--red": a, "--red-hot": mix(a, "#ffffff", 0.82), "--red-soft": rgba(a, 0.18), "--red-text": mix(a, "#ffffff", 0.62) };
  if (c.soft) {
    Object.assign(
      v,
      mode === "light"
        ? {
            "--bg": mix(a, "#ffffff", 0.055), "--s1": "#ffffff", "--s2": mix(a, "#ffffff", 0.09), "--s3": mix(a, "#ffffff", 0.16),
            "--line": mix(a, "#ffffff", 0.16), "--line-hover": mix(a, "#ffffff", 0.3), "--text": mix(a, "#16101a", 0.22),
            "--text2": mix(a, "#4f4f57", 0.28), "--text3": mix(a, "#7a7a84", 0.3), "--placeholder": mix(a, "#a1a1aa", 0.3),
            "--tabbar-bg": rgba(mix(a, "#ffffff", 0.04), 0.95), "--shadow": `0 12px 30px ${rgba(a, 0.16)}`,
          }
        : {
            "--bg": mix(a, "#0a0a0b", 0.06), "--s1": mix(a, "#141416", 0.08), "--s2": mix(a, "#1c1c1f", 0.1), "--s3": mix(a, "#26262a", 0.12),
            "--line": mix(a, "#2a2a2f", 0.16), "--line-hover": mix(a, "#3a3a40", 0.22), "--tabbar-bg": rgba(mix(a, "#0a0a0b", 0.06), 0.94),
          },
    );
  }
  return Object.entries(v).map(([k, x]) => `${k}:${x}`).join(";");
}

/** The CSS for someone's colors (dark, light, and "match my phone"). Empty for the AMBIT default. */
export function colorsCss(c: UserColors | null): string {
  if (!c) return "";
  const light = vars(c, "light");
  const dark = vars(c, "dark");
  const card = `.order-card{background:radial-gradient(120% 100% at 88% 0%, ${mix(c.accent, "#ffffff", 0.7)} 0%, ${c.accent} 42%, ${mix(c.accent, "#000000", 0.4)} 100%)}`;
  return `:root{${dark}}:root[data-theme="light"]{${light}}@media (prefers-color-scheme: light){:root[data-theme="system"]{${light}}}${card}`;
}
