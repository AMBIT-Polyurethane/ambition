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

export const lotKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ordKey = (s: string) => (/(\d{3,6})/.exec(s) ?? [])[1] ?? "";

const PAPER = new Set(["ambit_packing_slip", "bill_of_lading", "other_document"]);

function lotList(keys: string[], from: { key: string; text: string }[]) {
  return keys.map((k) => from.find((x) => x.key === k)?.text ?? k).join(", ");
}

/**
 * What's wrong with an order's signed BOL.
 *  recorded: the lots the app says went out (done inventory lines); sameAs: other orders with the same photo.
 */
export function bolProblems(orderNo: number, seen: BolSeen | null, recorded: (string | null)[], sameAs: number[]): BolProblem[] {
  const out: BolProblem[] = [];
  if (sameAs.length) {
    out.push({ code: "same_photo", tone: "err", text: `The same photo is also attached to ${sameAs.map((n) => `ORD-${n}`).join(", ")}. Each order needs its own signed BOL.` });
  }
  if (!seen) return out;
  const pages = seen.files ?? [];
  const mine = String(orderNo);
  const ords = [...new Set(pages.flatMap((p) => (p.order_numbers ?? []).map(ordKey)).filter(Boolean))];
  if (ords.length && !ords.includes(mine)) {
    out.push({ code: "wrong_order", tone: "err", text: `The photo is the paperwork for ${ords.map((n) => `ORD-${n}`).join(", ")}, not ORD-${mine}. The right signed BOL needs attaching.` });
  } else if (!ords.length && seen.matches_order === "no") {
    out.push({ code: "wrong_order", tone: "err", text: `The photo doesn't look like this order's paperwork: ${seen.why}` });
  }
  const paper = pages.filter((p) => PAPER.has(p.kind));
  if (pages.length && !paper.length) {
    out.push({ code: "not_paperwork", tone: "err", text: `The photo isn't readable signed paperwork (${pages.map((p) => p.shows).filter(Boolean).join("; ") || "nothing readable"}).` });
  } else if (paper.length && !paper.some((p) => p.signed)) {
    out.push({ code: "unsigned", tone: "warn", text: "No customer or driver signature on the BOL." });
  }

  // Lots: what was written by hand wins (that's what the warehouse says went out); else what the slip printed.
  const lots = paper.flatMap((p) => p.lots ?? []).filter((l) => lotKey(l.lot_no));
  const shown = lots.map((l) => ({ key: lotKey(l.lot_no), text: l.lot_no.trim() }));
  const rec = [...new Set(recorded.map(lotKey).filter(Boolean))];
  const recShown = rec.map((k) => ({ key: k, text: recorded.find((r) => lotKey(r) === k) ?? k }));
  const hand = lots.filter((l) => l.written === "handwritten" && l.clear);
  const printed = lots.filter((l) => l.written === "printed" && l.clear);
  const use = hand.length ? hand : printed;
  const doc = [...new Set(use.map((l) => lotKey(l.lot_no)))];
  const extra = doc.filter((k) => !rec.includes(k));
  if (extra.length) {
    const recText = rec.length ? lotList(rec, recShown) : "no lot";
    if (hand.length) {
      out.push({ code: "lot_mismatch", tone: "err", text: `Lots written on the BOL: ${lotList(doc, shown)}. The app recorded: ${recText}. Whoever loaded it needs to say which drums really went out (then fix it with Fix what went out).` });
    } else {
      out.push({ code: "lot_check", tone: "info", text: `The printed slip in the photo lists ${lotList(doc, shown)}; the app recorded ${recText} (changed after it was printed?). If ${lotList(extra, shown)} really went out, fix it with Fix what went out.` });
    }
  } else if (!out.some((p) => p.tone === "err") && lots.some((l) => !l.clear)) {
    out.push({ code: "hard_to_read", tone: "info", text: `Some lot numbers on the BOL are hard to read (${lots.filter((l) => !l.clear).map((l) => l.lot_no).join(", ")}): check the photo.` });
  }
  return out;
}
