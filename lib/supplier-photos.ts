import "server-only";
import sharp from "sharp";
import { PHOTO_BADGES } from "@/lib/photo-badges";

// Product photos from a supplier's website (AFCAT gave AMBIT written permission to reuse theirs), dressed like our own:
// 1600 x 1600 on white, the product trimmed, enlarged and sharpened, a soft floor shadow, and the AMBIT or ADC badge.

export const AFCAT_BASE = "https://afcatusa.com/wp-content/uploads/";

/** Our SKU -> the AFCAT product photo (matched by SKU, or by name and checked by eye). */
export const AFCAT_PHOTOS: [sku: string, path: string][] = [
  ["1295330495", "2024/06/PU-SprayFoam-Flush-4-5-Gal-scaled.jpg"],
  ["1308061326", "2026/10/Chem-Trend-FC-10008.webp"],
  ["1312800495", "2024/01/PU-SprayFoam-Remover-5-5-Gal-scaled.jpg"],
  ["1330521318", "2024/06/PU-SprayFoam-Silicone-scaled.jpg"],
  ["CT-SFS-MINI", "2024/06/PU-SprayFoam-Silicone-scaled.jpg"],
  ["AFA-CR4", "2025/05/AFCAT-Cloth-Rags.png"],
  ["S-1001-200PU", "2024/12/1001-200PU_6x6_silo-720x720-1.jpg"],
  ["S-NW-00253-300", "2024/02/cloth_rag.jpeg"],
  ["AFF-233814", "2025/02/AFF233814-angled.png"],
  ["F-EB8008", "2024/01/Fasco-12inch-Crown-Fine-Wire-Staples.png"],
  ["F84504", "2024/06/84504-2_r19_staple.jpg"],
  ["570338", "2024/06/AFCAT_Insulating_Foam_570338.jpg"],
  ["E50001", "2024/01/drierite_adapter.jpg"],
  ["AF5405", "2024/06/Corrugated_Vents.png"],
  ["BRD-48X96-GR", "2024/06/BarricadeBoard-e1728920974905.png"],
  ["MK-2050", "2024/04/Smooth_Vacuum_Hose.jpg"],
  ["MK-2550", "2024/04/Smooth_Vacuum_Hose.jpg"],
  ["MK-3050", "2024/04/Smooth_Vacuum_Hose.jpg"],
  ["MK-3550", "2024/04/Smooth_Vacuum_Hose.jpg"],
  ["MK-4050", "2024/04/Smooth_Vacuum_Hose.jpg"],
  ["VB22X48", "2024/02/GreenGuard-Foam-Attic-Rafter-Vents.png"],
  ["DC315-BLK", "2024/01/dc315_r.jpg"],
  ["DC315-DGR", "2024/01/dc315_r.jpg"],
  ["DC315-ICE", "2024/01/dc315_r.jpg"],
  ["DC315-WH", "2024/01/dc315_r.jpg"],
  ["NOBURN-GRAY", "2024/06/No-Burn_ThB_Gray.png"],
  ["NOBURN-CHAR", "2024/06/No-Burn_ThB_Gray.png"],
  ["NOBURN-WHITE", "2024/06/No-Burn_ThB_Gray.png"],
  ["3M-60921", "2026/05/60921.avif"],
  ["3M-6700L", "2026/05/3m-6000-Series-Full-Facepiece.jpg"],
  ["3M-6700M", "2026/05/3m-6000-Series-Full-Facepiece.jpg"],
  ["3M-8511", "2026/05/3M-N95-Vented.jpg"],
  ["AFS-1113-L", "2024/06/AFCATNitrileSmoothPalmGloves.png"],
  ["AFS-1113-M", "2024/06/AFCATNitrileSmoothPalmGloves.png"],
  ["AFS-1113-XL", "2024/06/AFCATNitrileSmoothPalmGloves.png"],
  ["AFS-1117-L", "2025/04/AFCAT-Dotted-Palm-Fiberglass-Gloves-3.png"],
  ["AFS-1117-XL", "2025/04/AFCAT-Dotted-Palm-Fiberglass-Gloves-3.png"],
  ["FT-N010", "2025/07/FT-N010.png"],
  ["S-12E90801", "2024/01/12E90801_600.jpg"],
  ["S-12E90806", "2024/01/12E90806_600.jpg"],
  ["S-150-2XL", "2024/01/AFCATCatSuit-01-e1716243583726.png"],
  ["S-150-3XL", "2024/01/AFCATCatSuit-01-e1716243583726.png"],
  ["S-150-L", "2024/01/AFCATCatSuit-01-e1716243583726.png"],
  ["S-150-XL", "2024/01/AFCATCatSuit-01-e1716243583726.png"],
  ["S-LP502XL", "2024/01/kleenguard_a35.jpg"],
  ["S-LP503XL", "2024/01/kleenguard_a35.jpg"],
  ["S-LP50L", "2024/01/kleenguard_a35.jpg"],
  ["S-LP50XL", "2024/01/kleenguard_a35.jpg"],
  ["S-MD502XL", "2025/06/Untitled-design-28.png"],
  ["S-MD503XL", "2025/06/Untitled-design-28.png"],
  ["S-MD50L", "2025/06/Untitled-design-28.png"],
  ["S-MD50XL", "2025/06/Untitled-design-28.png"],
  ["SCM46230", "2024/01/CM46230-cutproof_glove.jpg"],
  ["VG-A16A33-L", "2024/01/A16A3_1_720x.webp"],
  ["VG-A16A34-XL", "2024/01/A16A3_1_720x.webp"],
  ["VG-A19A32-M", "2024/05/A19A3_1_720x.jpg"],
  ["VG-A19A33-L", "2024/05/A19A3_1_720x.jpg"],
  ["VG-A19A34-XL", "2024/05/A19A3_1_720x.jpg"],
  ["WB-100", "2024/02/Web_Belt.jpg"],
  ["03509H", "2024/01/painters_plastic_.31m.jpg"],
  ["AFA-BDF08375", "2024/04/Meet-the-Team.png"],
  ["AFA-BDF09375", "2024/04/Meet-the-Team.png"],
  ["AFA-BDF10375", "2024/04/Meet-the-Team.png"],
  ["CF0410", "2024/01/poly_sheeting-1.jpg"],
  ["PSC03-20X100", "2024/01/7m_poly.jpg"],
  ["PSC15-12X200", "2024/06/poly_sheeting_1.5.jpg"],
  ["PSC15-20X200", "2024/06/poly_sheeting_1.5.jpg"],
  ["7079818700", "2024/06/powerpoint100_10ozctg_white_18700_6x6.jpg"],
  ["CO-911013", "2024/06/D-136.png"],
  ["T-487T15211", "2024/01/Red_Danger.png"],
  ["TD07-2S", "2024/01/Duct-Tape-Square.png"],
  ["233945", "2024/05/AFCAT-Foam-Depth-Gauge.jpg"],
  ["3AY71G", "2025/06/Bung-Wrench-1.png"],
  ["495-6538-21C", "2024/01/Milwakee-Saw-and-AFCAT-Adapter.png"],
  ["AFA-RUK1", "2025/01/AFCAT-Utility-Knife.png"],
  ["AG65078", "2024/01/7-1_Tool.png"],
  ["CD1", "2024/06/CD1.png"],
  ["CD2", "2024/06/CD2.png"],
  ["DURA-LLL 1422", "2024/06/DURA_III.png"],
  ["DURA-LLL 2440", "2024/06/DURA_III.png"],
  ["F20726010", "2024/01/r19_hammer_tacker.jpg"],
  ["FB-036", "2024/06/36_in_sawzall_blade.jpg"],
  ["FD1-24", "2026/01/AFCAT-Standard-Gun-24-inch.png"],
  ["FDTC-PG1", "2025/08/AFCAT-Premium-Foam-Gun-1.png"],
  ["HS029", "2024/01/foam_knife_29_in.jpg"],
  ["P-C2400", "2024/01/procell_aaa.jpg"],
  ["TP-102", "2024/01/tool_pouch.jpg"],
  ["UB 112-09", "2024/01/Replacement_Blades_UB105.jpg"],
  ["UB-117-99B", "2024/02/fixed-blade-knife.jpg"],
  ["UK600", "2024/01/Batt_Knife_B.png"],
  ["UK800", "2024/01/Batt_Knife_B.png"],
];

const CANVAS = 1600;
const BOX_W = 1120;
const BOX_H = 1000;
const CENTER_Y = 860;

export function photoSlug(sku: string): string {
  return sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

/** Downloads a supplier photo (with a normal browser's headers). */
export async function fetchPhoto(url: string): Promise<Buffer> {
  const r = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
      Referer: "https://afcatusa.com/shop/",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`The supplier's site answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 500) throw new Error("The photo came back empty");
  return buf;
}

/** The product alone: on white, trimmed to its edges, enlarged to fill the frame and sharpened. */
async function productLayer(src: Buffer) {
  const flat = await sharp(src, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).toColourspace("srgb").png().toBuffer();
  let trimmed = flat;
  try {
    trimmed = await sharp(flat).trim({ background: "#ffffff", threshold: 22 }).png().toBuffer();
  } catch {
    trimmed = flat;
  }
  const m = await sharp(trimmed).metadata();
  const w0 = m.width ?? 1;
  const h0 = m.height ?? 1;
  const scale = Math.min(BOX_W / w0, BOX_H / h0);
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const up = scale > 1;
  const buf = await sharp(trimmed)
    .resize(w, h, { kernel: "lanczos3", fit: "fill" })
    .sharpen(up ? { sigma: Math.min(1.6, 0.6 + scale * 0.35), m1: 0.6, m2: 2.4, x1: 2, y2: 12, y3: 18 } : { sigma: 0.6 })
    .modulate({ saturation: 1.06 })
    .linear(1.03, -3)
    .png()
    .toBuffer();
  return { buf, w, h };
}

function shadowSvg(cx: number, cy: number, rx: number, ry: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%">` +
      `<stop offset="0%" stop-color="#000" stop-opacity="0.16"/><stop offset="60%" stop-color="#000" stop-opacity="0.06"/><stop offset="100%" stop-color="#000" stop-opacity="0"/>` +
      `</radialGradient></defs><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#g)"/></svg>`,
  );
}

/** Both branded versions of one supplier photo: AMBIT (for the app) and ADC (for the web store), as JPEGs. */
export async function brandPhoto(src: Buffer): Promise<{ ambit: Buffer; adc: Buffer }> {
  const p = await productLayer(src);
  const left = Math.round((CANVAS - p.w) / 2);
  const top = Math.max(250, Math.min(CANVAS - 120 - p.h, Math.round(CENTER_Y - p.h / 2)));
  const floor = top + p.h;
  const shadow = shadowSvg(CANVAS / 2, Math.min(CANVAS - 60, floor + 8), Math.round(p.w * 0.46 + 40), Math.max(22, Math.round(p.w * 0.045)));
  const make = async (badge: { left: number; top: number; png: string }) =>
    sharp({ create: { width: CANVAS, height: CANVAS, channels: 3, background: "#ffffff" } })
      .composite([
        { input: shadow, left: 0, top: 0 },
        { input: p.buf, left, top, blend: "multiply" },
        { input: Buffer.from(badge.png, "base64"), left: badge.left, top: badge.top, blend: "multiply" },
      ])
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  const [ambit, adc] = await Promise.all([make(PHOTO_BADGES.ambit), make(PHOTO_BADGES.adc)]);
  return { ambit, adc };
}

/** Downloads one of our own photos (product storage) without the supplier's headers. */
export async function fetchOwnPhoto(url: string): Promise<Buffer> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`The photo didn't load (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 500) throw new Error("The photo came back empty");
  return buf;
}

const AMBIT_BADGE_BOX = { left: 64, top: 62, width: 266, height: 102 };

/** How much the top left of a 1600 x 1600 photo differs from the AMBIT badge (0 = the same; a plain white corner is far off). */
async function ambitBadgeDiff(flat1600: Buffer): Promise<number> {
  const raw = (b: Buffer) => sharp(b).extract(AMBIT_BADGE_BOX).greyscale().raw().toBuffer();
  const badge = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 3, background: "#ffffff" } })
    .composite([{ input: Buffer.from(PHOTO_BADGES.ambit.png, "base64"), left: PHOTO_BADGES.ambit.left, top: PHOTO_BADGES.ambit.top, blend: "multiply" }])
    .png()
    .toBuffer();
  const [a, b] = await Promise.all([raw(flat1600), raw(badge)]);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * The ADC version of a photo the app already has. One of our own AMBIT photos (square, the AMBIT oval at the top left)
 * keeps everything and only trades the oval for the ADC wordmark; any other photo is dressed like a supplier photo.
 */
export async function adcFromAppPhoto(src: Buffer): Promise<{ adc: Buffer; swapped: boolean }> {
  const meta = await sharp(src, { failOn: "none" }).rotate().metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const square = w > 300 && h > 300 && Math.abs(w - h) / Math.max(w, h) < 0.02;
  if (square) {
    const flat = await sharp(src, { failOn: "none" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .resize(CANVAS, CANVAS, { kernel: "lanczos3", fit: "fill" })
      .png()
      .toBuffer();
    if ((await ambitBadgeDiff(flat)) < 30) {
      const white = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="130"><rect width="300" height="130" fill="#fff"/></svg>`);
      const adc = await sharp(flat)
        .composite([
          { input: white, left: 52, top: 52 },
          { input: Buffer.from(PHOTO_BADGES.adc.png, "base64"), left: PHOTO_BADGES.adc.left, top: PHOTO_BADGES.adc.top, blend: "multiply" },
        ])
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      return { adc, swapped: true };
    }
  }
  return { adc: (await brandPhoto(src)).adc, swapped: false };
}
