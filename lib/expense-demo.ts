import "server-only";
import type { XReceipt } from "@/lib/expense-kinds";

// Made-up receipt pictures for the expense demo (photos saved as "demo:<receipt id>"). Drawn here from the
// receipt's own numbers with a tiny dot-matrix font, like a register's printout, so nothing is stored and no
// fonts are needed on the server.

export const isDemoPhoto = (key: string) => key.startsWith("demo:");

// 5x7 dot-matrix letters.
const G: Record<string, string> = {
  A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01110100011000010000100001000101110",
  D: "11100100101000110001100011001011100", E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000",
  G: "01110100011000010111100011000101111", H: "10001100011000111111100011000110001", I: "01110001000010000100001000010001110",
  J: "00111000100001000010000101001001100", K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001", N: "10001100011100110101100111000110001", O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000", Q: "01110100011000110001101011001001101", R: "11110100011000111110101001001010001",
  S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100", U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100", W: "10001100011000110101101011010101010", X: "10001100010101000100010101000110001",
  Y: "10001100011000101010001000010000100", Z: "11111000010001000100010001000011111",
  "0": "01110100011001110101110011000101110", "1": "00100011000010000100001000010001110", "2": "01110100010000100010001000100011111",
  "3": "11111000100010000010000011000101110", "4": "00010001100101010010111110001000010", "5": "11111100001111000001000011000101110",
  "6": "00110010001000011110100011000101110", "7": "11111000010001000100010000100001000", "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000010001001100",
  " ": "00000000000000000000000000000000000", ".": "00000000000000000000000000110001100", ",": "00000000000000000000011000010001000",
  ":": "00000011000110000000011000110000000", "-": "00000000000000011111000000000000000", "/": "00000000010001000100010001000000000",
  "#": "01010010101111101010111110101001010", "&": "01100100101010001000101011001001101", "'": "01100001000100000000000000000000000",
  $: "00100011111010001110001011111000100", "*": "00000001001010101110101010010000000", "@": "01110100010000101101101011010101110",
  "(": "00010001000100001000010000010000010", ")": "01000001000001000010000100010001000", "%": "11000110010001000100010001001100011",
  "+": "00000001000010011111001000010000000", "=": "00000000001111100000111110000000000", _: "00000000000000000000000000000011111",
  "!": "00100001000010000100001000000000100", "?": "01110100010000100010001000000000100",
};

const W = 40; // characters per line
const PX = 2; // dot size
const CW = 6 * PX; // character cell
const LH = 10 * PX; // line height

/** Same receipt, same picture: a small random-number generator seeded from its id. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const money = (n: number) => n.toFixed(2);
const center = (t: string) => {
  const s = t.slice(0, W);
  return " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
};
const lr = (l: string, r: string) => {
  const left = l.slice(0, W - r.length - 1);
  return left + " ".repeat(Math.max(1, W - left.length - r.length)) + r;
};

const TOWNS = ["OKLAHOMA CITY, OK", "EDMOND, OK", "ARLINGTON, TX", "FORT WORTH, TX", "SAN MARCOS, TX", "NEW BRAUNFELS, TX", "MOBILE, AL", "DAPHNE, AL", "JACKSONVILLE, FL", "AMARILLO, TX"];
const FOOD = ["LUNCH SPECIAL", "SIRLOIN 8OZ", "CHICKEN FAJITAS", "ICED TEA", "CAESAR SALAD", "SHRIMP PLATTER", "BURGER BASKET", "ENCHILADA PLATE", "SODA", "COFFEE", "QUESO", "RIBEYE 12OZ", "CATCH OF THE DAY"];
const SUPPLIES = ["POLY SHEETING 10X100", "DUCT TAPE 3PK", "MASKING PAPER", "RAGS 10LB", "GLOVES NITRILE", "EXTENSION CORD 50FT", "GAS CAN 5GAL", "ZIP TIES", "HOSE CLAMPS", "O-RING KIT"];

/** The lines printed on the receipt. */
function receiptLines(r: Pick<XReceipt, "id" | "vendor" | "bought_on" | "amount" | "tip" | "category" | "paid_with" | "card_last4" | "attendees">, chargedMore: boolean): string[] {
  const rand = rng(r.id);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const total = Number(r.amount);
  const [y, m, d] = r.bought_on.split("-");
  const hh = 7 + Math.floor(rand() * 12);
  const mm = String(Math.floor(rand() * 60)).padStart(2, "0");
  const time = `${hh > 12 ? hh - 12 : hh}:${mm} ${hh >= 12 ? "PM" : "AM"}`;
  const L: string[] = [];
  L.push(center(r.vendor.toUpperCase()));
  L.push(center(`STORE #${100 + Math.floor(rand() * 900)}`));
  L.push(center(pick(TOWNS)));
  L.push(center(`TEL (${pick(["405", "817", "512", "251", "904"])}) 555-0${100 + Math.floor(rand() * 899)}`));
  L.push("");
  L.push(lr(`${m}/${d}/${y}`, time));
  L.push(lr(`TRANS ${10000 + Math.floor(rand() * 89999)}`, `REG ${1 + Math.floor(rand() * 6)}`));
  L.push("-".repeat(W));
  const tax = r.category === "Fuel" || r.category === "Airfare & travel" ? 0 : r.category === "Lodging" ? 0.13 : 0.0825;
  const sub = Math.round((total / (1 + tax)) * 100) / 100;
  const parts = (n: number) => {
    const w = Array.from({ length: n }, () => 0.5 + rand());
    const s = w.reduce((a, b) => a + b, 0);
    const out = w.map((x) => Math.round(((sub * x) / s) * 100) / 100);
    out[out.length - 1] = Math.round((sub - out.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
    return out;
  };
  switch (r.category) {
    case "Fuel": {
      const price = 2.79 + rand() * 0.7;
      const gal = sub / price;
      L.push(`PUMP ${String(1 + Math.floor(rand() * 16)).padStart(2, "0")}   ${total > 110 ? "DIESEL #2" : "UNLEADED"}`);
      L.push(lr(`${gal.toFixed(3)} GAL @ $${price.toFixed(3)}`, money(sub)));
      break;
    }
    case "Lodging": {
      const nights = /2 night/i.test(r.vendor) || total > 300 ? 2 : 1;
      L.push(`ROOM ${100 + Math.floor(rand() * 400)}   ${nights} NIGHT${nights > 1 ? "S" : ""}`);
      L.push(lr(`ROOM RATE X ${nights}`, money(sub)));
      break;
    }
    case "Airfare & travel": {
      if (/airline|southwest/i.test(r.vendor)) {
        L.push(`CONF ${Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rand() * 32)]).join("")}`);
        L.push(lr(`${pick(["MOB", "OKC", "DFW", "AUS"])}-${pick(["JAX", "BNA", "MSY", "ATL"])} RT  1 ADT`, money(sub)));
      } else L.push(lr(pick(["RENTAL 2 DAYS", "TRIP", "DAILY PARKING"]), money(sub)));
      break;
    }
    case "Meals":
    case "Customer entertainment": {
      const n = Math.max(2, Math.min(6, Math.round(total / 35)));
      const ps = parts(n);
      ps.forEach((p) => L.push(lr(`${1 + Math.floor(rand() * 2)} ${pick(FOOD)}`, money(p))));
      if (r.attendees) L.push(`GUESTS: ${Math.max(2, Math.min(6, Math.round(total / 45)))}`);
      break;
    }
    case "Tools & supplies": {
      parts(Math.max(1, Math.min(5, Math.round(total / 30)))).forEach((p) => L.push(lr(pick(SUPPLIES), money(p))));
      break;
    }
    case "Vehicle & equipment repair": {
      parts(2).forEach((p, i) => L.push(lr(i ? "SHOP SUPPLIES / LABOR" : total > 500 ? "LT245/75R16 TIRES X4" : "SYN OIL CHANGE + BRAKES", money(p))));
      break;
    }
    case "Shipping": {
      L.push(lr(`UPS GROUND  ${1 + Math.floor(rand() * 3)} PKG`, money(sub)));
      L.push(`TRACKING 1Z${Math.floor(rand() * 1e9)}`);
      break;
    }
    default:
      L.push(lr(r.category.toUpperCase(), money(sub)));
  }
  L.push("-".repeat(W));
  L.push(lr("SUBTOTAL", money(sub)));
  if (tax) L.push(lr("TAX", money(Math.round((total - sub) * 100) / 100)));
  if (r.tip) L.push(lr("TIP", money(Number(r.tip))));
  L.push(lr("TOTAL", `$${money(total)}`));
  if (chargedMore) {
    L.push("");
    L.push(lr("TIP:", "________"));
    L.push(lr("TOTAL:", "________"));
  }
  L.push("");
  L.push(r.paid_with === "personal" ? lr("MASTERCARD ************" + String(1000 + Math.floor(rand() * 8999)), "") : lr(`VISA ************${r.card_last4 ?? "0000"}`, ""));
  L.push(`AUTH ${100000 + Math.floor(rand() * 899999)}   CHIP READ`);
  L.push("");
  L.push(center("THANK YOU"));
  L.push(center("PLEASE COME AGAIN"));
  return L;
}

/** A photo-like JPEG of the receipt (paper on a dark counter, a little crooked). */
export async function demoReceiptJpeg(
  r: Pick<XReceipt, "id" | "vendor" | "bought_on" | "amount" | "tip" | "category" | "paid_with" | "card_last4" | "attendees">,
  opts: { chargedMore?: boolean; width?: number } = {},
): Promise<Buffer> {
  const lines = receiptLines(r, Boolean(opts.chargedMore));
  const pad = 28;
  const pw = W * CW + pad * 2;
  const ph = lines.length * LH + pad * 2;
  const buf = Buffer.alloc(pw * ph * 3);
  const rand = rng(`${r.id}:paper`);
  for (let i = 0; i < pw * ph; i++) {
    const n = Math.floor(rand() * 10);
    buf[i * 3] = 247 - n;
    buf[i * 3 + 1] = 244 - n;
    buf[i * 3 + 2] = 236 - n;
  }
  const dot = (x: number, y: number, ink: number) => {
    for (let dy = 0; dy < PX; dy++)
      for (let dx = 0; dx < PX; dx++) {
        const o = ((y + dy) * pw + (x + dx)) * 3;
        buf[o] = ink;
        buf[o + 1] = ink;
        buf[o + 2] = ink + 6;
      }
  };
  lines.forEach((line, li) => {
    const ink = 40 + Math.floor(rand() * 30);
    [...line.toUpperCase()].forEach((ch, ci) => {
      const g = G[ch] ?? G["?"];
      for (let k = 0; k < 35; k++) if (g[k] === "1") dot(pad + ci * CW + (k % 5) * PX, pad + li * LH + Math.floor(k / 5) * PX, ink);
    });
  });
  const sharp = (await import("sharp")).default;
  const angle = (rand() - 0.5) * 4;
  const img = await sharp(buf, { raw: { width: pw, height: ph, channels: 3 } })
    .extend({ top: 40, bottom: 40, left: 40, right: 40, background: { r: 58, g: 52, b: 46 } })
    .rotate(angle, { background: { r: 58, g: 52, b: 46 } })
    .resize({ width: Math.min(1400, opts.width ?? 900), withoutEnlargement: false })
    .jpeg({ quality: 82 })
    .toBuffer();
  return img;
}
