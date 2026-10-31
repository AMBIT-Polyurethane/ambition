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
            raw: { type: "string", description: "The line as written (description, quantity and unit)" },
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

/** Files from the "inventory-files" bucket, ready for Claude: photos made smaller, PDFs as documents. */
async function fileBlocks(supabase: SupabaseClient, paths: string[]): Promise<Anthropic.Messages.ContentBlockParam[]> {
  const out: Anthropic.Messages.ContentBlockParam[] = [];
  for (const p of paths.slice(0, 4)) {
    const { data } = await supabase.storage.from("inventory-files").download(p);
    if (!data) continue;
    const buf = await data.arrayBuffer();
    if (/\.pdf$/i.test(p)) {
      if (buf.byteLength > 20 * 1024 * 1024) continue;
      out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buf).toString("base64") } });
    } else {
      const small = await shrinkImage(buf, 2000, 82);
      if (!small) continue;
      out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.body.toString("base64") } });
    }
  }
  return out;
}

export async function readBol(opts: { supabase: SupabaseClient; branchName: string; items: BolItem[]; paths: string[] }): Promise<BolRead> {
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
- The shipper is the company sending it, not AMBIT and not the carrier.
- Today is ${todayCentral()} (America/Chicago).

ITEMS STOCKED AT ${opts.branchName.toUpperCase()} (ref | SKU | name | unit):
${list}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  const blocks = await fileBlocks(supabase, opts.paths);
  if (!blocks.length) throw new Error("Couldn't open the file. Try the photo or PDF again.");
  const content: Anthropic.Messages.ContentBlockParam[] = [...blocks, { type: "text", text: "Here is the delivery document. Record it." }];
  const { data: raw, usage } = await fillForm<Record<string, unknown>>({ model, maxTokens: 8000, system, content, ...FORM });
  const out = (raw ?? {}) as {
    shipper?: string;
    bol_no?: string;
    po_no?: string;
    carrier?: string;
    ship_date?: string;
    items?: { raw?: string; ref?: string; qty?: number; lot_no?: string; mfg?: string; exp?: string; confidence?: string; note?: string }[];
    notes?: string;
  };
  const lines: BolLine[] = (out.items ?? []).slice(0, 80).map((it) => {
    const m = /^I(\d+)$/i.exec(String(it.ref ?? "").trim());
    const p = m ? items[Number(m[1]) - 1] : undefined;
    const conf = it.confidence === "high" || it.confidence === "medium" ? it.confidence : "low";
    const lot = String(it.lot_no ?? "").trim().toUpperCase().slice(0, 40);
    return {
      raw: String(it.raw ?? "").slice(0, 300),
      product_id: p?.product_id ?? null,
      qty: Math.max(0, Math.min(100000, Number(it.qty) || 0)),
      lot_no: lot || null,
      mfg: ISO_DATE.test(String(it.mfg ?? "")) ? String(it.mfg) : null,
      exp: ISO_DATE.test(String(it.exp ?? "")) ? String(it.exp) : null,
      confidence: p ? conf : "low",
      note: it.note ? String(it.note).slice(0, 300) : null,
    };
  });
  const clean = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max) || null;
  return {
    vendor: clean(out.shipper, 120),
    bol_no: clean(out.bol_no, 60),
    po_no: clean(out.po_no, 60),
    carrier: clean(out.carrier, 80),
    ship_date: ISO_DATE.test(String(out.ship_date ?? "")) ? String(out.ship_date) : null,
    lines,
    notes: clean(out.notes, 500),
    cost_cents: costCents(model, usage),
    model,
  };
}
