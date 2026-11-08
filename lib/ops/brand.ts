// AMBIT-OPS colors from the contractor's logo. AMBIT keeps the frame (black, white, AMBIT red, the atom);
// the contractor's colors drive buttons, highlights, widgets and charts inside their workspace.
// Status colors never change: green = good, amber = look at this, red = problem.
// Everything here is plain math, safe on the server and in the browser.

export type BrandTheme = { primary?: string | null; secondary?: string | null; palette?: string[] | null };

type RGB = [number, number, number];
type Lab = [number, number, number]; // OKLab

const AMBIT_RED = "#e33527";
const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (s: unknown): s is string => typeof s === "string" && HEX.test(s);

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]: RGB): Lab {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToLinear([L, a, b]: Lab): RGB {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (c: RGB) => c.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH lightness / chroma / hue (degrees). */
export function toLch(hex: string): [number, number, number] {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}
/** Back to hex, pulling chroma in until it fits on screen. */
export function fromLch(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  let c = C;
  for (let i = 0; i < 30; i++) {
    const lin = oklabToLinear([L, c * Math.cos(h), c * Math.sin(h)]);
    if (inGamut(lin)) return rgbToHex(lin.map(fromLin) as RGB);
    c *= 0.9;
  }
  return rgbToHex(oklabToLinear([L, 0, 0]).map(fromLin) as RGB);
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Moves lightness until the color reads against a background (WCAG ratio). */
function readable(hex: string, bg: string, min: number, dir: 1 | -1): string {
  const [L0, C, H] = toLch(hex);
  let L = L0;
  let out = hex;
  for (let i = 0; i < 40 && contrast(out, bg) < min; i++) {
    L = Math.max(0.05, Math.min(0.97, L + dir * 0.015));
    out = fromLch(L, C, H);
  }
  return out;
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Distance between two colors as people see it (OKLab x100). */
export function deltaE(a: string, b: string) {
  const p = rgbToOklab(hexToRgb(a)), q = rgbToOklab(hexToRgb(b));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export type BrandPalette = {
  primary: string;
  secondary: string;
  /** From the logo (true) or AMBIT's own colors (no logo yet). */
  fromLogo: boolean;
};

/** The two brand colors to use. Too-grey or missing colors fall back to AMBIT red. */
export function pickBrand(theme: BrandTheme | null | undefined, color?: string | null): BrandPalette {
  // The Brand color in Settings wins (it starts as the logo's main color and the owner can change it).
  const primary = isHex(color) ? color! : isHex(theme?.primary) ? theme!.primary! : null;
  if (!primary || toLch(primary)[1] < 0.03) return { primary: AMBIT_RED, secondary: "#f5b53f", fromLogo: false };
  let secondary = isHex(theme?.secondary) ? theme!.secondary! : null;
  const [, , h1] = toLch(primary);
  if (!secondary || toLch(secondary)[1] < 0.03 || hueGap(toLch(secondary)[2], h1) < 25) {
    // Nothing distinct in the logo: a split-complement of the main color.
    const [L, C] = toLch(primary);
    secondary = fromLch(Math.max(0.72, L), Math.max(0.1, C * 0.9), (h1 + 150) % 360);
  }
  return { primary, secondary, fromLogo: true };
}

const DARK_BG = "#141416";
const LIGHT_BG = "#ffffff";

/** CSS custom properties for one appearance (dark or light). */
function varsFor(p: BrandPalette, mode: "dark" | "light") {
  const bg = mode === "dark" ? DARK_BG : LIGHT_BG;
  const [L, C, H] = toLch(p.primary);
  // Button / fill: keep the brand's own look, but never so dark it vanishes on black or so light it vanishes on white.
  const fillL = mode === "dark" ? Math.min(Math.max(L, 0.6), 0.8) : Math.min(Math.max(L, 0.45), 0.66);
  const fill = fromLch(fillL, C, H);
  const ink = contrast(fill, "#ffffff") >= 4.5 ? "#ffffff" : "#0b0b0d";
  const hot = fromLch(Math.min(0.92, fillL + (mode === "dark" ? 0.06 : -0.06)), C, H);
  const text = readable(fromLch(mode === "dark" ? Math.max(L, 0.74) : Math.min(L, 0.5), C, H), bg, 4.5, mode === "dark" ? 1 : -1);
  const [L2, C2, H2] = toLch(p.secondary);
  const fill2 = fromLch(mode === "dark" ? Math.min(Math.max(L2, 0.68), 0.85) : Math.min(Math.max(L2, 0.5), 0.68), C2, H2);
  const text2 = readable(fill2, bg, 4.5, mode === "dark" ? 1 : -1);
  // Chart colors, in a fixed order: the brand, its partner, then a third hue between them.
  const c3 = fromLch(mode === "dark" ? 0.72 : 0.56, Math.max(0.08, (C + C2) / 2), (H + 60) % 360);
  return {
    "--b": fill,
    "--b-ink": ink,
    "--b-hot": hot,
    "--b-text": text,
    "--b-soft": rgba(fill, mode === "dark" ? 0.16 : 0.12),
    "--b-line": rgba(fill, 0.45),
    "--b-glow": rgba(fill, mode === "dark" ? 0.32 : 0.2),
    "--b2": fill2,
    "--b2-text": text2,
    "--b2-soft": rgba(fill2, mode === "dark" ? 0.16 : 0.14),
    "--c1": fill,
    "--c2": fill2,
    "--c3": c3,
    // Inside the workspace AMBIT's red parts take the contractor's color; AMBIT red stays on --ambit.
    "--red": fill,
    "--red-hot": hot,
    "--red-soft": rgba(fill, mode === "dark" ? 0.16 : 0.1),
    "--red-text": text,
  } as Record<string, string>;
}

const block = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(";");

/** A <style> body that themes everything inside .ops-brand, for dark, light and "match my device". */
export function brandCss(p: BrandPalette): string {
  const dark = block(varsFor(p, "dark"));
  const light = block(varsFor(p, "light"));
  // The AMBIT Intelligence panel and the phone's atom button sit outside the workspace wrapper (they're
  // part of the app frame), so they take the same colors by name.
  const at = (pre: string) => [".ops-brand", ".ix-root", ".tab-ai", ".ops-ai-btn"].map((c) => `${pre}${c}`).join(",");
  return [
    `${at("")}{${dark}}`,
    `${at(':root[data-theme="light"] ')},${at(".theme-light ")}{${light}}`,
    `@media (prefers-color-scheme: light){${at(':root[data-theme="system"] ')}{${light}}}`,
  ].join("");
}
