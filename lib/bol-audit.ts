// 0082: what the AI read off an order's signed BOL, and what's wrong with it (worked out against the order as it
// is right now, so a lot fixed with "Fix what went out" drops off straight away).

export type BolLot = { lot_no: string; product: string; qty: number; written: "printed" | "handwritten"; clear: boolean };

export type BolPage = {
  file: number;
  kind: "ambit_packing_slip" | "bill_of_lading" | "other_document" | "not_a_document" | "unreadable";
  shows: string;
  order_numbers: string[];
  customer: string;
  signed: boolean;
  lots: BolLot[];
};

export type BolSeen = { files: BolPage[]; matches_order: "yes" | "no" | "unclear"; why: string };

export type BolProblem = {
  code: "wrong_order" | "not_paperwork" | "same_photo" | "lot_mismatch" | "unsigned" | "lot_check" | "hard_to_read";
  tone: "err" | "warn" | "info";
  text: string;
};

/** The Data check list each problem goes on. */
export const BOL_KIND: Record<BolProblem["code"], string> = {
  wrong_order: "bol_wrong",
  not_paperwork: "bol_wrong",
  same_photo: "bol_wrong",
  lot_mismatch: "bol_lots",
  unsigned: "bol_unsigned",
  lot_check: "bol_check",
  hard_to_read: "bol_check",
};

/** For comparing lots: letters and digits only, and the letter O read as zero (GEO23461 = GE023461). */
export const lotKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0");
const digits = (s: string | null | undefined) => (/(\d{3,8})/.exec(s ?? "") ?? [])[1] ?? "";

/** Edits (with swapped neighbours as one) between two lot keys, up to 3. */
function near(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return Math.min(3, d[a.length][b.length]);
}

const PAPER = new Set(["ambit_packing_slip", "bill_of_lading", "other_document"]);

export type BolOrder = { order_no: number; ambit_po?: string | null; invoice_no?: string | null; po_number?: string | null };

/**
 * What's wrong with an order's signed BOL.
 *  recorded: the lots the app says went out (done inventory lines; null = a line with no lot);
 *  sameAs: other orders with the very same photo; whoIs: which order a number on the paper belongs to
 *  (its ORD number, Sales Order # or invoice #), so a Sales Order # isn't mistaken for another order.
 */
export function bolProblems(order: BolOrder, seen: BolSeen | null, recorded: (string | null)[], sameAs: number[], whoIs: (num: string) => number | null = () => null): BolProblem[] {
  const out: BolProblem[] = [];
  const pages = seen?.files ?? [];
  const mine = new Set([String(order.order_no), digits(order.ambit_po), digits(order.invoice_no), digits(order.po_number)].filter(Boolean));
  const nums = [...new Set(pages.flatMap((p) => (p.order_numbers ?? []).map(digits)).filter(Boolean))];
  const ours = nums.some((n) => mine.has(n) || whoIs(n) === order.order_no);
  // Numbers on the paper that belong to a different order.
  const others = [...new Set(nums.filter((n) => !mine.has(n)).map((n) => whoIs(n)).filter((n): n is number => n !== null && n !== order.order_no))];

  let wrong = false;
  if (sameAs.length && !ours) {
    wrong = true;
    out.push({ code: "same_photo", tone: "err", text: `The same photo is also attached to ${sameAs.map((n) => `ORD-${n}`).join(", ")}. Each order needs its own signed BOL.` });
  }
  if (!seen) return out;
  if (!ours && others.length) {
    wrong = true;
    out.push({ code: "wrong_order", tone: "err", text: `The photo is the paperwork for ${others.map((n) => `ORD-${n}`).join(", ")}, not ORD-${order.order_no}. This order's own signed BOL needs attaching.` });
  } else if (!ours && seen.matches_order === "no") {
    wrong = true;
    out.push({ code: "wrong_order", tone: "err", text: `The photo isn't this order's paperwork: ${seen.why}` });
  }
  const paper = pages.filter((p) => PAPER.has(p.kind));
  if (pages.length && !paper.length) {
    out.push({ code: "not_paperwork", tone: "err", text: `The photo isn't readable signed paperwork (${pages.map((p) => p.shows).filter(Boolean).join("; ") || "nothing readable"}).` });
    return out;
  }
  if (wrong) return out; // the signature and lots on it are another order's
  if (paper.length && !paper.some((p) => p.signed)) out.push({ code: "unsigned", tone: "warn", text: "No customer or driver signature on the BOL." });

  // Lots: what was written by hand wins (that's what the warehouse says went out); else what the slip printed.
  const lots = paper.flatMap((p) => p.lots ?? []).filter((l) => lotKey(l.lot_no));
  const label = new Map<string, string>();
  for (const l of lots) if (!label.has(lotKey(l.lot_no))) label.set(lotKey(l.lot_no), l.lot_no.trim());
  for (const r of recorded) if (r && !label.has(lotKey(r))) label.set(lotKey(r), r);
  const show = (keys: string[]) => keys.map((k) => label.get(k) ?? k).join(", ");
  const rec = [...new Set(recorded.map(lotKey).filter(Boolean))];
  const noLotLines = recorded.some((r) => !lotKey(r));
  const hand = lots.filter((l) => l.written === "handwritten" && l.clear);
  const printed = lots.filter((l) => l.written === "printed" && l.clear);
  const use = hand.length ? hand : printed;
  const doc = [...new Set(use.map((l) => lotKey(l.lot_no)))];
  const extra = doc.filter((k) => !rec.includes(k));
  const recText = rec.length ? show(rec) : "no lot";
  if (extra.length && hand.length && !noLotLines) {
    out.push({ code: "lot_mismatch", tone: "err", text: `Lot${extra.length === 1 ? "" : "s"} ${show(extra)} ${extra.length === 1 ? "is" : "are"} written on the BOL, but the app recorded ${recText}. Whoever loaded it needs to say which drums really went out (then fix it with Fix what went out).` });
  } else if (extra.length && noLotLines) {
    out.push({ code: "lot_check", tone: "info", text: `The BOL shows lot ${show(extra)}, and the app has no lot for some items on this order. If an item is counted by lot, add it with Fix what went out.` });
  } else if (extra.length) {
    out.push({ code: "lot_check", tone: "info", text: `The printed slip in the photo lists ${show(doc)}; the app recorded ${recText} (changed after it was printed?). If ${show(extra)} really went out, fix it with Fix what went out.` });
  } else if (rec.length) {
    // Hard to read, and not close to any lot the app recorded.
    const odd = lots.filter((l) => !l.clear && !rec.some((k) => near(lotKey(l.lot_no), k) <= 1));
    if (odd.length) out.push({ code: "hard_to_read", tone: "info", text: `Lot ${odd.map((l) => l.lot_no).join(", ")} on the BOL is hard to read and doesn't match what the app recorded (${recText}): check the photo.` });
  }
  return out;
}

/** What the AI made of one attached page: the right order, another order's, or not paperwork at all. */
export type FileVerdict = { tone: "ok" | "err" | "warn" | "none"; text: string; belongsTo: number | null };

/** One verdict per page the AI read (by its file number, 1 = the first file). */
export function fileVerdicts(order: BolOrder, seen: BolSeen | null, whoIs: (num: string) => number | null = () => null): Map<number, FileVerdict> {
  const out = new Map<number, FileVerdict>();
  if (!seen) return out;
  const mine = new Set([String(order.order_no), digits(order.ambit_po), digits(order.invoice_no), digits(order.po_number)].filter(Boolean));
  for (const p of seen.files ?? []) {
    const nums = [...new Set((p.order_numbers ?? []).map(digits).filter(Boolean))];
    const ours = nums.some((n) => mine.has(n) || whoIs(n) === order.order_no);
    const others = [...new Set(nums.filter((n) => !mine.has(n)).map((n) => whoIs(n)).filter((n): n is number => n !== null && n !== order.order_no))];
    let v: FileVerdict;
    if (p.kind === "not_a_document") v = { tone: "err", text: "Not paperwork", belongsTo: null };
    else if (p.kind === "unreadable") v = { tone: "warn", text: "Too blurry to read", belongsTo: null };
    else if (ours) v = { tone: "ok", text: p.signed ? "Right order · signed" : "Right order · no signature", belongsTo: null };
    else if (others.length) v = { tone: "err", text: `Looks like ORD-${others[0]}`, belongsTo: others[0] };
    else if (seen.matches_order === "no") v = { tone: "err", text: "Not this order's paperwork", belongsTo: null };
    else v = { tone: "none", text: "No order # on it", belongsTo: null };
    out.set(Number(p.file), v);
  }
  return out;
}
