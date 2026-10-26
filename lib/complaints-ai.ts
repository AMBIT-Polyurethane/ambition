import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costCents, fillForm } from "@/lib/ai/claude";
import { loadAiSettings } from "@/lib/assistant/settings";
import { SYMPTOMS } from "@/lib/complaints";
import { todayCentral } from "@/lib/sale";

// Fills in a complaint report from an Ask AMBIT conversation (what people said, and what Ask AMBIT saw
// in their photos). Only what was actually said goes in; blanks stay blank for the person to finish.

const FORM = {
  name: "fill_report",
  description: "Fill in the AMBIT complaint report with only what the conversation says.",
  schema: {
    type: "object",
    properties: {
      company_name: { type: "string", description: "Contractor or customer company" },
      contact_name: { type: "string" },
      contact_phone: { type: "string" },
      contact_email: { type: "string" },
      job_name: { type: "string", description: "Job or homeowner name" },
      job_address: { type: "string" },
      product: { type: "string", description: "AMBIT product, e.g. AMBI-SEAL 5.0" },
      lot_numbers: { type: "string" },
      sets_used: { type: "string" },
      date_sprayed: { type: "string", description: "YYYY-MM-DD" },
      application: { type: "string", description: "Where it was sprayed: walls, roof deck, attic floor, crawlspace, metal building..." },
      thickness: { type: "string" },
      substrate: { type: "string" },
      substrate_temp: { type: "string" },
      substrate_moisture: { type: "string" },
      ambient_temp: { type: "string" },
      humidity: { type: "string" },
      equipment: { type: "string", description: "Proportioner, A and B temperatures, pressure, hose heat" },
      symptoms: { type: "array", items: { type: "string", enum: SYMPTOMS.map((s) => s.id) } },
      description: { type: "string", description: "What the customer reported, in plain words" },
      ai_notes: {
        type: "string",
        description: "What Ask AMBIT saw in the photos and what AMBIT teaching (name the TSBs) says about it, and what's still needed. Plain, factual, no conclusions about fault.",
      },
    },
  } as Record<string, unknown>,
};

export type ComplaintFill = Record<string, string | string[] | null> & { symptoms?: string[] };

export async function fillFromConversation(supabase: SupabaseClient, transcript: string): Promise<{ fill: ComplaintFill; cost: number }> {
  const settings = await loadAiSettings(supabase);
  const model = settings?.model ?? "claude-sonnet-5-5";
  const { data, usage } = await fillForm<Record<string, unknown>>({
    model,
    maxTokens: 6000,
    system: `You fill in AMBIT Polyurethane's spray foam complaint report from a conversation with Ask AMBIT. Use only what the conversation says; leave anything not stated empty (an empty string). Don't guess lot numbers, dates or temperatures. Today is ${todayCentral()}.`,
    content: `The conversation:\n"""\n${transcript.slice(0, 30000)}\n"""`,
    ...FORM,
  });
  const raw = (data ?? {}) as Record<string, unknown>;
  const fill: ComplaintFill = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "symptoms") fill.symptoms = Array.isArray(v) ? v.map(String).filter((x) => SYMPTOMS.some((s) => s.id === x)) : [];
    else if (typeof v === "string" && v.trim()) fill[k] = v.trim().slice(0, k === "ai_notes" || k === "description" ? 6000 : 300);
  }
  if (fill.date_sprayed && !/^\d{4}-\d{2}-\d{2}$/.test(String(fill.date_sprayed))) delete fill.date_sprayed;
  return { fill, cost: costCents(model, usage) };
}
