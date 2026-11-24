import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costCents, fillForm } from "@/lib/ai/claude";
import { shrinkImage } from "@/lib/image-shrink";
import { loadAiSettings } from "@/lib/assistant/settings";
import { todayCentral } from "@/lib/sale";

// Reads a bill of lading / packing slip (photos or a PDF) into a Receiving Report: who shipped it, the
// BOL and PO numbers, the carrier, and each line matched to what this location stocks, with lot numbers
// and dates for spray foam. The warehouse manager checks every line before anything goes into stock.

export type BolItem = { product_id: string; sku: string; name: string; unit: string; lots: boolean };

export type BolLine = {
  raw: string;
  product_id: string | null;
  qty: number;
  lot_no: string | null;
  mfg: string | null;
  exp: string | null;
  confidence: "high" | "medium" | "low";
  note: string | null;
};

export type BolRead = {
  vendor: string | null;
  bol_no: string | null;
  po_no: string | null;
  carrier: string | null;
  ship_date: string | null;
  lines: BolLine[];
  notes: string | null;
  cost_cents: number;
  model: string;
  /** Photos / PDFs read, and how many of them couldn't be read (the rest still came back). */
  pages: number;
  failed: number;
};

const FORM = {
  name: "record_bol",
  description: "Record the delivery document exactly as written, each line matched to the location's items.",
  schema: {
    type: "object",
    properties: {
      shipper: { type: "string", description: "Who shipped it (the vendor / shipper / 'from' company), as written" },
      bol_no: { type: "string", description: "The BOL / bill of lading / delivery / shipment number" },
      po_no: { type: "string", description: "AMBIT's purchase order number, if shown" },
      carrier: { type: "string", description: "The trucking company / carrier" },
      ship_date: { type: "string", description: "Ship date as YYYY-MM-DD, or empty" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            raw: { type: "string", description: "The line's description as written, short (no line numbers)" },
            part_no: { type: "string", description: "The vendor's item / part number for this line as printed (like 246627 or FX37RD), or empty" },
            ref: { type: "string", description: "The item ref like I12, or empty if nothing on the list fits" },
            qty: { type: "number", description: "How many, in the listed item's unit (drums, bags, boxes, rolls...)" },
            lot_no: { type: "string", description: "Lot / batch number for this line, or empty" },
            mfg: { type: "string", description: "Manufacture date as YYYY-MM-DD, or empty" },
            exp: { type: "string", description: "Expiration date as YYYY-MM-DD, or empty" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            note: { type: "string", description: "What the receiver should check, or empty" },
          },
          required: ["raw", "qty", "confidence"],
        },
      },
      notes: { type: "string", description: "Anything else on the document the receiver should know (damage noted, seal numbers, hazmat), or empty" },
    },
    required: ["items"],
  } as Record<string, unknown>,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Files from the "inventory-files" bucket, ready for Claude (one per file, in order): photos made smaller, PDFs as documents. */
async function fileBlocks(supabase: SupabaseClient, paths: string[]): Promise<(Anthropic.Messages.ContentBlockParam | null)[]> {
  return Promise.all(
    paths.slice(0, MAX_FILES).map(async (p): Promise<Anthropic.Messages.ContentBlockParam | null> => {
      const { data } = await supabase.storage.from("inventory-files").download(p);
      if (!data) return null;
      const buf = await data.arrayBuffer();
      if (/\.pdf$/i.test(p)) {
        if (buf.byteLength > 20 * 1024 * 1024) return null;
        return { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buf).toString("base64") } };
      }
      // Packing lists are small print: keep enough of the photo to read every line.
      const small = await shrinkImage(buf, 2400, 85);
      if (!small) return null;
      return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.body.toString("base64") } };
    }),
  );
}

/** Up to this many photos / PDFs are read at once (one Claude call each, side by side). */
export const MAX_FILES = 6;

/** A part number or SKU, compared without spaces, dashes or dots (54-4910 = 544910). */
const partKey = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function readBol(opts: { supabase: SupabaseClient; branchName: string; items: BolItem[]; paths: string[]; kind?: "bol" | "packing" }): Promise<BolRead> {
  const { supabase, items } = opts;
  const settings = await loadAiSettings(supabase);
  const model = settings?.model ?? "claude-sonnet-5-5";
  const list = items.map((p, i) => `I${i + 1} | ${p.sku} | ${p.name} | unit: ${p.unit}${p.lots ? " | tracked by lot" : ""}`).join("\n");
  const system: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: `You read bills of lading, packing slips and delivery receipts for trucks arriving at AMBIT Polyurethane's ${opts.branchName} warehouse (spray foam chemicals, insulation and supplies), and record them matched to the items that location stocks (below).
Rules:
- One line per item per lot. If the same product comes in two lots, that's two lines, each with its own quantity and lot number.
- Pick the item ref only when you're confident it's the same product (brand, R-value, size, color, A-side/B-side all matter). If nothing fits, leave ref empty and confidence "low".
- Spray foam: ISO (the A side, pMDI / MDI / isocyanate) is stocked by brand: Covestro (Mondur, lot numbers often start "PA" or "ORXF"), Wanhua (Wannate, numeric lots like 2605P0437), Huntsman (Rubinate, lots start "GEO"), Dow (PAPI). Pick the brand's ISO item. AMBIT resins (the B side): AMBI-SEAL 5.0 (open cell), AMBI-TITE 204 (closed cell HFO), AMBI-ROOF, AMBI-JACK. Lot numbers starting "LW" are the Winter version; "L" then digits is Summer.
- Quantities are in the item's unit (usually drums for foam). Convert pallets or cases to the item's unit only when the document says how many are in each (for example 39 bags per pallet), and say so in "note". Totes, pails and drums are different items.
- Dates as YYYY-MM-DD. Never invent lot numbers, dates or quantities. If a number is hard to read, give your best reading, set confidence "medium" or "low" and say what to check in "note".
- Gun parts and other supplies (Graco, Binks, PMC...): put the vendor's item / part number for the line in part_no exactly as printed. Our SKU is usually that same number, so pick the item whose SKU is that number.
- Record every line on the document, even long lists (a Graco packing list runs about 50 lines a page). Keep "raw" short: the description only.
- The shipper is the company sending it, not AMBIT and not the carrier.
- Today is ${todayCentral()} (America/Chicago).

ITEMS STOCKED AT ${opts.branchName.toUpperCase()} (ref | SKU | name | unit):
${list}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  const files = await fileBlocks(supabase, opts.paths);
  const blocks = files.filter((f): f is Anthropic.Messages.ContentBlockParam => f !== null);
  if (!blocks.length) throw new Error("Couldn't open the file. Try the photo or PDF again.");
  const many = blocks.length > 1;
  // Which document this is (0067: every report has both). The packing list is the manufacturer's own record of
  // lots and dates; the BOL is the trucking paperwork, where lot numbers are often written in by hand.
  const said =
    opts.kind === "packing"
      ? "Here is the manufacturer's packing list for this truck. Its lot / batch numbers, quantities and dates are the manufacturer's own: record them exactly as printed."
      : opts.kind === "bol"
        ? "Here is the bill of lading (BOL) for this truck. Lot / batch numbers on a BOL are often written in by hand at our warehouse: if a lot number is handwritten, still record it, but set confidence no higher than \"medium\" and say \"handwritten\" in that line's note."
        : "Here is the delivery document.";
  const pageNote = (n: number) =>
    many
      ? ` This is photo / file ${n} of ${blocks.length} of the same paperwork (the others are read separately): record every line on THIS one, even if the page starts or ends mid-list. Record it.`
      : " Record every line on it. Record it.";
  type Out = {
    shipper?: string;
    bol_no?: string;
    po_no?: string;
    carrier?: string;
    ship_date?: string;
    items?: { raw?: string; part_no?: string; ref?: string; qty?: number; lot_no?: string; mfg?: string; exp?: string; confidence?: string; note?: string }[];
    notes?: string;
  };
  // One call per photo / PDF, side by side: a long packing list (Graco's run ~50 lines a page) fits in each
  // answer, and three pages take as long as one.
  const reads = await Promise.allSettled(
    blocks.map((blk, i) =>
      fillForm<Out>({ model, maxTokens: 16000, timeout: 120_000, system, content: [blk, { type: "text", text: said + pageNote(i + 1) }], ...FORM }),
    ),
  );
  const ok = reads.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) throw (reads[0] as PromiseRejectedResult).reason;
  for (const r of reads) if (r.status === "rejected") console.error("BOL page read failed", r.reason);

  // Each item's SKU, to match the part number printed on the line (the vendor's number is often our SKU).
  const bySku = new Map<string, number>();
  items.forEach((p, i) => {
    const k = partKey(p.sku);
    if (k.length >= 3) bySku.set(k, bySku.has(k) ? -1 : i); // -1: two items share it, don't guess
  });
  const skuMatch = (part: string): number | null => {
    const k = partKey(part);
    if (k.length < 3) return null;
    const hit = bySku.get(k);
    return hit !== undefined && hit >= 0 ? hit : null;
  };

  const first = <K extends keyof Out>(k: K) => ok.map((r) => r.data[k]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const lines: BolLine[] = ok
    .flatMap((r) => r.data.items ?? [])
    .slice(0, 300)
    .map((it) => {
      const m = /^I(\d+)$/i.exec(String(it.ref ?? "").trim());
      let idx = m ? Number(m[1]) - 1 : -1;
      let conf: BolLine["confidence"] = it.confidence === "high" || it.confidence === "medium" ? it.confidence : "low";
      // The printed part number is the surest match: it wins over Claude's pick when it's exactly an item's SKU.
      const bySkuIdx = skuMatch(String(it.part_no ?? ""));
      if (bySkuIdx !== null) {
        if (bySkuIdx !== idx) conf = "high";
        idx = bySkuIdx;
      }
      const p = idx >= 0 ? items[idx] : undefined;
      const lot = String(it.lot_no ?? "").trim().toUpperCase().slice(0, 40);
      const part = String(it.part_no ?? "").trim();
      const raw = String(it.raw ?? "").trim();
      return {
        raw: (part && !raw.toUpperCase().includes(part.toUpperCase()) ? `${part} ${raw}` : raw).slice(0, 300),
        product_id: p?.product_id ?? null,
        qty: Math.max(0, Math.min(100000, Number(it.qty) || 0)),
        lot_no: lot || null,
        mfg: ISO_DATE.test(String(it.mfg ?? "")) ? String(it.mfg) : null,
        exp: ISO_DATE.test(String(it.exp ?? "")) ? String(it.exp) : null,
        confidence: p ? conf : "low",
        note: it.note ? String(it.note).slice(0, 300) : p ? null : `Not on ${opts.branchName}'s item list: pick the item, or remove the line.`,
      };
    });
  const clean = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max) || null;
  const notes = [...new Set(ok.map((r) => (r.data.notes ?? "").trim()).filter(Boolean))].join(" ");
  const shipDate = ok.map((r) => String(r.data.ship_date ?? "")).find((d) => ISO_DATE.test(d)) ?? null;
  return {
    vendor: clean(first("shipper"), 120),
    bol_no: clean(first("bol_no"), 60),
    po_no: clean(first("po_no"), 60),
    carrier: clean(first("carrier"), 80),
    ship_date: shipDate,
    lines,
    notes: clean(notes, 500),
    cost_cents: ok.reduce((n, r) => n + costCents(model, r.usage), 0),
    model,
    pages: blocks.length,
    failed: reads.length - ok.length + (files.length - blocks.length),
  };
}
