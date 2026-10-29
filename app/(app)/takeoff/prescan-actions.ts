"use server";

import type Anthropic from "@anthropic-ai/sdk";
import { takeoffAccess } from "@/lib/takeoff/access";
import { claudeReady, costCents, fillForm, friendlyClaudeError } from "@/lib/ai/claude";
import { loadAiSettings } from "@/lib/assistant/settings";
import { DEFAULT_MODEL } from "@/lib/assistant/config";
import { SCAN_SCHEMA, SCAN_SYSTEM, cleanScan, type ScanResult, type SheetScan } from "@/lib/takeoff/prescan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SheetInput = { sheet_id: string; name: string | null; images: string[]; text: string };

/** Claude reads one plan sheet (pictures of it plus the PDF's own text). */
export async function prescanSheet(takeoffId: string, input: SheetInput): Promise<{ ok: boolean; error?: string; scan?: SheetScan; cost?: number }> {
  const a = await takeoffAccess();
  if (!a) return { ok: false, error: "Not allowed." };
  if (!UUID.test(takeoffId) || !UUID.test(input.sheet_id)) return { ok: false, error: "Sheet not found." };
  const { data: sheet } = await a.supabase.from("takeoff_sheets").select("id").eq("id", input.sheet_id).eq("takeoff_id", takeoffId).maybeSingle();
  if (!sheet) return { ok: false, error: "Sheet not found." };
  if (!claudeReady()) return { ok: false, error: "The AI isn't set up in this app yet (ANTHROPIC_API_KEY)." };
  const images = (input.images ?? []).filter((d) => typeof d === "string" && d.startsWith("data:image/jpeg;base64,") && d.length < 2_800_000).slice(0, 3);
  if (!images.length) return { ok: false, error: "The sheet's picture didn't come through." };
  const settings = await loadAiSettings(a.supabase);
  const model = settings?.model ?? DEFAULT_MODEL;
  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: "text", text: `Sheet: ${String(input.name ?? "unnamed").slice(0, 60)}. ${images.length > 1 ? "The first picture is the whole sheet; the others are its left and right halves, larger." : "The whole sheet."}` },
    ...images.map((d) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: d.slice("data:image/jpeg;base64,".length) } })),
  ];
  const text = String(input.text ?? "").replace(/\s+/g, " ").trim().slice(0, 9000);
  if (text) content.push({ type: "text", text: `Text found on this sheet (out of order):\n"""\n${text}\n"""` });
  try {
    const { data, usage } = await fillForm<Record<string, unknown>>({
      model,
      maxTokens: 4000,
      system: SCAN_SYSTEM,
      content,
      name: "sheet_findings",
      description: "What this plan sheet says about insulation, roof pitch, wall heights, garage, porch and attic.",
      schema: SCAN_SCHEMA as unknown as Record<string, unknown>,
    });
    return { ok: true, scan: cleanScan(data), cost: costCents(model, usage) };
  } catch (e) {
    return { ok: false, error: friendlyClaudeError(e) };
  }
}

/** Keeps the pre-scan on the takeoff, so it's there next time. */
export async function saveScan(takeoffId: string, scan: ScanResult): Promise<{ ok: boolean }> {
  const a = await takeoffAccess();
  if (!a || !UUID.test(takeoffId)) return { ok: false };
  const clean: ScanResult = {
    at: new Date().toISOString(),
    cost_cents: Number(scan.cost_cents) || 0,
    sheets: (scan.sheets ?? []).slice(0, 60).map((x) => ({ sheet_id: String(x.sheet_id).slice(0, 40), name: x.name ? String(x.name).slice(0, 80) : null, scan: cleanScan(x.scan) })),
  };
  const { error } = await a.supabase.from("takeoffs").update({ ai_scan: clean }).eq("id", takeoffId);
  return { ok: !error };
}
