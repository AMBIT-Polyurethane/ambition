import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costCents, fillForm, photoBlocks } from "@/lib/ai/claude";
import { loadAiSettings } from "@/lib/assistant/settings";
import { todayCentral } from "@/lib/sale";
import type { Branch } from "@/lib/types";

// AI order intake: reads a texted / emailed order (or a photo of a handwritten one) and turns it into a
// draft order: which customer, which AMBIT location, which products and how many. Staff check every
// line before the order goes anywhere.

export type DraftItem = { raw: string; product_id: string | null; qty: number; confidence: "high" | "medium" | "low"; note?: string | null };

export type CustomerMatch = { id: string; name: string; account_no: string | null; score: number };

type Company = { id: string; name: string; account_no: string | null; phone: string | null; email: string | null; contact_name: string | null; default_branch_id: string | null };
type Prod = { id: string; sku: string; name: string; unit: string; sqft_per_unit: number | null; category: string | null };

const STOP = new Set(["llc", "inc", "co", "company", "corp", "corporation", "ltd", "the", "and", "of", "insulation", "spray", "foam", "services", "service", "group", "llp"]);
const words = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "").slice(-10);

/** Best-matching customers for what the order said (name, account number, phone, email). */
export function matchCustomers(companies: Company[], said: { name?: string | null; account_no?: string | null; phone?: string | null; email?: string | null; contact?: string | null }): CustomerMatch[] {
  const nameWords = new Set(words(`${said.name ?? ""}`));
  const contactWords = new Set(words(`${said.contact ?? ""}`));
  const phone = digits(said.phone);
  const email = (said.email ?? "").trim().toLowerCase();
  const acct = (said.account_no ?? "").trim().toLowerCase();
  const scored = companies.map((c) => {
    let score = 0;
    if (acct && c.account_no && c.account_no.toLowerCase() === acct) score = 1;
    if (phone.length >= 10 && digits(c.phone) === phone) score = Math.max(score, 0.95);
    if (email && c.email && c.email.toLowerCase() === email) score = Math.max(score, 0.95);
    const cw = words(c.name);
    if (nameWords.size && cw.length) {
      const hit = cw.filter((w) => nameWords.has(w)).length;
      const jac = hit / new Set([...cw, ...nameWords]).size;
      const cover = hit / cw.length;
      score = Math.max(score, Math.min(0.9, jac * 0.5 + cover * 0.45));
    }
    if (contactWords.size && c.contact_name) {
      const hit = words(c.contact_name).filter((w) => contactWords.has(w)).length;
      if (hit) score = Math.max(score, 0.35 + 0.15 * hit);
    }
    return { id: c.id, name: c.name, account_no: c.account_no, score: Math.round(score * 100) / 100 };
  });
  return scored.filter((s) => s.score >= 0.25).sort((a, b) => b.score - a.score).slice(0, 6);
}

function matchBranch(branches: Branch[], hint: string | null | undefined): string | null {
  const h = (hint ?? "").toLowerCase();
  if (!h.trim()) return null;
  const aliases: Record<string, string[]> = {
    okc: ["okc", "oklahoma city", "council", "oklahoma"],
    atx: ["arlington", "dallas", "fort worth", "dfw"],
    smx: ["san marcos", "austin", "san antonio"],
    jax: ["jacksonville", "jax"],
    mob: ["mobile"],
  };
  for (const b of branches) {
    const names = [b.name, ...(aliases[b.id] ?? [])].map((x) => x.toLowerCase()).filter(Boolean);
    if (names.some((n) => n.length >= 3 && h.includes(n))) return b.id;
  }
  return null;
}

const FORM = {
  name: "record_order",
  description: "Record the order exactly as it was asked for, matched to AMBIT's catalog.",
  schema: {
    type: "object",
    properties: {
      customer: {
        type: "object",
        description: "Who the order is for, as written (leave out what isn't there)",
        properties: {
          name: { type: "string" },
          account_no: { type: "string" },
          contact: { type: "string", description: "The person's name" },
          phone: { type: "string" },
          email: { type: "string" },
        },
      },
      location: { type: "string", description: "Which AMBIT location or city it's picked up from or shipped from, as written" },
      delivery: { type: "string", enum: ["pickup", "jobsite", "dropship", "unknown"] },
      ship_address: { type: "string", description: "Job site or delivery address, if given" },
      needed_by: { type: "string", description: "Date needed as YYYY-MM-DD (work out words like 'Thursday' from today's date), or empty" },
      po_number: { type: "string", description: "The customer's PO number, if given" },
      notes: { type: "string", description: "Anything else for AMBIT (gate codes, call ahead, etc.)" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            raw: { type: "string", description: "The line as written" },
            ref: { type: "string", description: "Catalog ref like P12, or empty if nothing in the catalog fits" },
            qty: { type: "number", description: "How many, in the catalog item's unit (convert square feet to bags using sq ft per bag, rounding up)" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            note: { type: "string", description: "Why it's not certain, or anything staff should check" },
          },
          required: ["raw", "qty", "confidence"],
        },
      },
      questions: { type: "string", description: "Anything unclear that staff should ask the customer" },
    },
    required: ["items"],
  } as Record<string, unknown>,
};

export type ReadResult = {
  customer_text: string;
  matches: CustomerMatch[];
  company_id: string | null;
  branch_id: string | null;
  delivery_method: "pickup" | "jobsite" | "dropship" | null;
  ship_address: string | null;
  po_number: string | null;
  needed_by: string | null;
  notes: string | null;
  items: DraftItem[];
  questions: string | null;
  model: string;
  cost_cents: number;
};

export async function readOrder(opts: { supabase: SupabaseClient; uid: string; text: string; photos: string[] }): Promise<ReadResult> {
  const { supabase } = opts;
  const settings = await loadAiSettings(supabase);
  const model = settings?.model ?? "claude-sonnet-5-5";
  const [{ data: prodRows }, { data: catRows }, { data: compRows }, { data: branchRows }] = await Promise.all([
    supabase.from("products").select("id, sku, name, unit, sqft_per_unit, category_id").eq("active", true).order("sort").order("name"),
    supabase.from("categories").select("id, name"),
    supabase.from("companies").select("id, name, account_no, phone, email, contact_name, default_branch_id").eq("active", true),
    supabase.from("branches").select("*").eq("active", true).order("sort"),
  ]);
  const cats = new Map(((catRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const products: Prod[] = ((prodRows ?? []) as (Prod & { category_id: string | null })[]).map((p) => ({ ...p, category: p.category_id ? cats.get(p.category_id) ?? null : null }));
  const branches = (branchRows ?? []) as Branch[];
  const companies = (compRows ?? []) as Company[];

  const catalog = products
    .map((p, i) => `P${i + 1} | ${p.sku} | ${p.name} | unit: ${p.unit}${p.sqft_per_unit ? ` | ${p.sqft_per_unit} sq ft per ${p.unit}` : ""}${p.category ? ` | ${p.category}` : ""}`)
    .join("\n");
  const system: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: `You read orders sent to AMBIT Polyurethane (spray foam chemicals, insulation and supplies) by text, email or handwritten note, and record them (customer, location, delivery, dates, PO, items) matched to AMBIT's catalog below.
Rules:
- One item per product asked for. Copy each line as written into "raw".
- Pick the catalog ref only when you're confident it's the same product (brand, R-value, size, thickness, A-side/B-side all matter). Spray foam is sold by the drum: ISO (the A side, pMDI) and each resin (the B side: AMBI-SEAL 5.0, AMBI-TITE 204, AMBI-JACK, AMBI-ROOF...) are separate drums, and a "set" is one ISO drum plus one resin drum. So "2 sets of 5.0" means 2 drums of AMBI-SEAL 5.0 plus 2 drums of ISO; "2 drums of 5.0" means only the resin. ISO is one catalog item ("ISO A-Side"): AMBIT picks the brand and lot, so a brand named for ISO (Covestro, Wanhua...) still maps to it. AMBI-SEAL 5.0 and AMBI-TITE 204 come as Summer and Winter versions: use Winter only if the order says winter (or "W"); otherwise use Summer, set confidence "medium" and say "Summer or Winter?" in "note". If two catalog items could fit, pick the likeliest, set confidence "medium" and say what to check in "note". If nothing fits, leave ref empty and confidence "low".
- Quantities are in the catalog item's unit. If they give square feet for a product sold by the bag with a sq ft per bag, convert and round up, and say so in "note".
- Never invent items, quantities, dates or PO numbers. Leave out what isn't there.
- Today is ${todayCentral()} (America/Chicago).
AMBIT locations: ${branches.map((b) => `${b.name}, ${b.state} (${b.id})`).join("; ")}.

CATALOG (ref | SKU | name | unit | ...):
${catalog}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  const images = await photoBlocks(supabase, opts.photos, opts.uid);
  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...images,
    { type: "text", text: opts.text.trim() ? `The order:\n"""\n${opts.text.trim().slice(0, 12000)}\n"""` : "The order is in the photo(s)." },
  ];

  const { data: raw, usage } = await fillForm<Record<string, unknown>>({ model, maxTokens: 8000, system, content, ...FORM });
  const out = (raw ?? {}) as {
    customer?: { name?: string; account_no?: string; contact?: string; phone?: string; email?: string };
    location?: string;
    delivery?: string;
    ship_address?: string;
    needed_by?: string;
    po_number?: string;
    notes?: string;
    items?: { raw?: string; ref?: string; qty?: number; confidence?: string; note?: string }[];
    questions?: string;
  };

  const cust = out.customer ?? {};
  const matches = matchCustomers(companies, cust);
  const best = matches[0] && matches[0].score >= 0.5 ? matches[0] : null;
  const company = best ? companies.find((c) => c.id === best.id) ?? null : null;
  const items: DraftItem[] = (out.items ?? []).slice(0, 80).map((it) => {
    const m = /^P(\d+)$/i.exec(String(it.ref ?? "").trim());
    const p = m ? products[Number(m[1]) - 1] : undefined;
    const conf = it.confidence === "high" || it.confidence === "medium" ? it.confidence : "low";
    return {
      raw: String(it.raw ?? "").slice(0, 300),
      product_id: p?.id ?? null,
      qty: Math.max(0, Math.min(100000, Number(it.qty) || 0)),
      confidence: p ? conf : "low",
      note: it.note ? String(it.note).slice(0, 300) : null,
    };
  });
  const delivery = out.delivery === "pickup" || out.delivery === "jobsite" || out.delivery === "dropship" ? out.delivery : null;
  const needed = /^\d{4}-\d{2}-\d{2}$/.test(String(out.needed_by ?? "")) ? String(out.needed_by) : null;
  const customerText = [cust.name, cust.contact, cust.account_no, cust.phone, cust.email].filter(Boolean).join(" · ");

  return {
    customer_text: customerText,
    matches,
    company_id: company?.id ?? null,
    branch_id: matchBranch(branches, out.location) ?? company?.default_branch_id ?? null,
    delivery_method: delivery,
    ship_address: out.ship_address?.trim() || null,
    po_number: out.po_number?.trim() || null,
    needed_by: needed,
    notes: out.notes?.trim() || null,
    items,
    questions: out.questions?.trim() || null,
    model,
    cost_cents: costCents(model, usage),
  };
}
