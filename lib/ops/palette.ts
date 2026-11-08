"use client";

import { rgbToHex, toLch } from "@/lib/ops/brand";

// Reads a logo in the browser and picks its main colors. Greys, black and white are skipped (they're the
// background and the lettering, not the brand); colors are grouped by hue and weighted by how much of
// the logo they cover and how vivid they are.

export type LogoColors = { primary: string; secondary: string | null; palette: string[] };

function hsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read the logo."));
    img.src = src;
  });

export async function logoColors(file: Blob | string): Promise<LogoColors | null> {
  const url = typeof file === "string" ? file : URL.createObjectURL(file);
  try {
    const img = await load(url);
    const size = 120;
    const scale = Math.min(1, size / Math.max(img.naturalWidth || size, img.naturalHeight || size));
    const w = Math.max(1, Math.round((img.naturalWidth || size) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || size) * scale));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const BINS = 36;
    const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      const [hue, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
      if (s < 0.22 || l < 0.1 || l > 0.93) continue;
      const weight = s * (1 - Math.abs(l - 0.5));
      const bin = bins[Math.floor(hue / (360 / BINS)) % BINS];
      bin.w += weight;
      bin.r += px[i] * weight;
      bin.g += px[i + 1] * weight;
      bin.b += px[i + 2] * weight;
    }
    // Merge each bin with its neighbors so a gradient counts as one color.
    const merged = bins.map((b, i) => {
      const n = [bins[(i + BINS - 1) % BINS], b, bins[(i + 1) % BINS]];
      return { i, w: n.reduce((a, x) => a + x.w, 0), core: b };
    });
    const total = bins.reduce((a, b) => a + b.w, 0);
    if (total < 1) return null;
    const ranked = merged.filter((m) => m.core.w > 0).sort((a, b) => b.w - a.w);
    const picked: { i: number; hex: string }[] = [];
    for (const m of ranked) {
      if (picked.some((p) => Math.min(Math.abs(p.i - m.i), BINS - Math.abs(p.i - m.i)) < 3)) continue;
      if (m.w < total * 0.04) break;
      const c = m.core;
      picked.push({ i: m.i, hex: rgbToHex([c.r / c.w, c.g / c.w, c.b / c.w]) });
      if (picked.length >= 5) break;
    }
    if (!picked.length) return null;
    // The accent: the most vivid of the other colors (lettering is often a dark navy; a gold star wins over it).
    const h0 = toLch(picked[0].hex)[2];
    const gap = (h: number) => Math.min(Math.abs(h - h0), 360 - Math.abs(h - h0));
    const accent = picked
      .slice(1)
      .map((p) => ({ hex: p.hex, lch: toLch(p.hex) }))
      .filter((p) => gap(p.lch[2]) >= 30)
      .sort((a, b) => b.lch[1] - a.lch[1])[0];
    return { primary: picked[0].hex, secondary: accent?.hex ?? null, palette: picked.map((p) => p.hex) };
  } catch {
    return null;
  } finally {
    if (typeof file !== "string") URL.revokeObjectURL(url);
  }
}
