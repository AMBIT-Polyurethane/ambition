"use server";

import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { takeoffAccess, type TakeoffAccess } from "@/lib/takeoff/access";
import { ClaudeStop, claudeReady, costCents, friendlyClaudeError, streamForm } from "@/lib/ai/claude";
import { CORRECTION_TEMPLATE, RECONCILE_SCHEMA, RECONCILE_SYSTEM, SHEET_SCHEMA, SHEET_SYSTEM, rulesBlock } from "@/lib/takeoff/ai-prompts";
import { fakeReconcile, fakeSheetRead } from "@/lib/takeoff/ai-fake";
import {
  COMPONENT_KINDS,
  FACT_TOPICS,
  SIDES,
  cleanRead,
  readForCorrection,
  readSummary,
  type Discrepancy,
  type Reconciled,
  type RuleUsed,
  type SheetAi,
  type TakeoffAi,
} from "@/lib/takeoff/ai-read";

// The teachable takeoff AI: it reads one sheet at a time (shapes as JSON in pixels of the picture), puts
// the sheets together in a short text-only check, and takes corrections that can be remembered as rules.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Plans are read with the most careful model (set TAKEOFF_AI_MODEL in Vercel to change it). */
const PLAN_MODEL = () => process.env.TAKEOFF_AI_MODEL?.trim() || "claude-opus-5-5";
const fake = () => process.env.TAKEOFF_AI_FAKE === "1";

type TakeoffRow = { id: string; name: string; builder: string | null; ops_company_id: string | null; ai_read: TakeoffAi | null };
type SheetRow = { id: string; name: string | null; page: number; ft_per_pt: number | null; scale_label: string | null; ai: SheetAi | null };

async function load(takeoffId: string): Promise<{ a: TakeoffAccess; t: TakeoffRow } | { error: string }> {
  const a = await takeoffAccess();
  if (!a) return { error: "Not allowed." };
  if (!UUID.test(takeoffId)) return { error: "Takeoff not found." };
  const { data: t } = await a.supabase.from("takeoffs").select("id, name, builder, ops_company_id, ai_read").eq("id", takeoffId).maybeSingle<TakeoffRow>();
  if (!t) return { error: "Takeoff not found." };
  return { a, t };
}

/** The team's active rules for this takeoff. Contractors don't get the text of AMBIT's own rules back. */
async function rulesFor(a: TakeoffAccess, t: TakeoffRow): Promise<{ prompt: string; used: RuleUsed[] }> {
  const { data } = await a.supabase.rpc("takeoff_rules_for", { p_takeoff: t.id, p_kind: "plans" });
  const rows = (data ?? []) as { id: string; text: string; builder: string | null; mine: boolean }[];
  const hide = Boolean(t.ops_company_id);
  return {
    prompt: rulesBlock(rows),
    used: rows.map((r) => ({ id: r.id, text: hide && !r.mine ? null : r.text, builder: r.builder, mine: r.mine })),
  };
}

async function log(a: TakeoffAccess, t: TakeoffRow, row: { sheet_id?: string | null; sheet_name?: string | null; kind: "read" | "correct" | "reconcile"; model: string; ok: boolean; error?: string | null; usage?: Anthropic.Messages.Usage | null; ms?: number; rules?: number; result?: unknown }) {
  await a.supabase.from("takeoff_ai_calls").insert({
    takeoff_id: t.id,
    sheet_id: row.sheet_id ?? null,
    sheet_name: row.sheet_name ?? null,
    kind: row.kind,
    model: row.model,
    ok: row.ok,
    error: row.error ? String(row.error).slice(0, 500) : null,
    input_tokens: row.usage?.input_tokens ?? null,
    output_tokens: row.usage?.output_tokens ?? null,
    cost_cents: row.usage ? costCents(row.model, row.usage) : null,
    ms: row.ms ?? null,
    rules: row.rules ?? null,
    result: row.result ?? null,
    ops_company_id: t.ops_company_id,
    created_by_name: a.profile.full_name || a.profile.email,
  });
}

export type ReadInput = {
  sheet_id: string;
  /** The sheet as a JPEG or PNG data URL, sized to fit what the AI takes. */
  image: string;
  /** Pixels of that picture per PDF point. */
  px_per_pt: number;
  /** The PDF's own text on this sheet (out of order). */
  text: string;
  correction?: { text: string; remember: "once" | "all" | "builder"; builder?: string | null } | null;
};
export type ReadResult =
  | { ok: true; ai: SheetAi; rule: { id: string; text: string; builder: string | null } | null }
  | { ok: false; error: string; resize?: { w: number; h: number } };

/** Reads one plan sheet (or re-reads it with a correction). The reading is saved on the sheet. */
export async function readSheetAi(takeoffId: string, input: ReadInput): Promise<ReadResult> {
  const l = await load(takeoffId);
  if ("error" in l) return { ok: false, error: l.error };
  const { a, t } = l;
  if (!UUID.test(input.sheet_id)) return { ok: false, error: "Sheet not found." };
  const { data: sheet } = await a.supabase.from("takeoff_sheets").select("id, name, page, ft_per_pt, scale_label, ai").eq("id", input.sheet_id).eq("takeoff_id", t.id).maybeSingle<SheetRow>();
  if (!sheet) return { ok: false, error: "Sheet not found." };
  if (!claudeReady() && !fake()) return { ok: false, error: "The AI isn't set up in this app yet (ANTHROPIC_API_KEY)." };

  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(input.image ?? "");
  if (!m || m[2].length > 4_200_000) return { ok: false, error: "The sheet's picture didn't come through (too big). Try again." };
  // The picture's exact size: the AI answers in its pixels.
  let w = 0;
  let h = 0;
  try {
    const meta = await sharp(Buffer.from(m[2], "base64")).metadata();
    w = meta.width ?? 0;
    h = meta.height ?? 0;
  } catch {
    // checked below
  }
  const pxPerPt = Number(input.px_per_pt);
  if (!w || !h || !(pxPerPt > 0)) return { ok: false, error: "The sheet's picture didn't come through. Try again." };

  const corr = input.correction?.text?.trim() ? { ...input.correction, text: input.correction.text.trim().slice(0, 2000) } : null;
  const prev = sheet.ai;
  if (corr && (!prev || prev.w !== w || prev.h !== h)) return { ok: false, error: "Read this sheet first, then tell the AI what to fix." };

  const name = (sheet.name || `Page ${sheet.page}`).slice(0, 60);
  const rules = await rulesFor(a, t);
  const pxPerFt = sheet.ft_per_pt ? pxPerPt / Number(sheet.ft_per_pt) : null;
  const intro = [
    `This image is exactly ${w} × ${h} pixels, origin top-left (x to the right, y down). Give every coordinate in pixels of this image.`,
    `Sheet: ${name}.`,
    sheet.scale_label ? `Printed scale read from the PDF: ${sheet.scale_label}${pxPerFt ? `, which is ${Math.round(pxPerFt * 100) / 100} pixels per foot on this image` : ""}. Check it against a long written dimension.` : "No scale was read from the PDF text: find the printed scale and check it against a long written dimension.",
    t.builder ? `Builder: ${t.builder}.` : "",
  ].filter(Boolean).join("\n");
  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: "text", text: intro },
    { type: "image", source: { type: "base64", media_type: m[1] === "png" ? "image/png" : "image/jpeg", data: m[2] } },
  ];
  const pdfText = String(input.text ?? "").replace(/\s+/g, " ").trim().slice(0, 9000);
  if (pdfText) content.push({ type: "text", text: `Text found on this sheet in the PDF (out of order; use it to read small print exactly):\n"""\n${pdfText}\n"""` });
  if (corr && prev) {
    content.push({
      type: "text",
      text: CORRECTION_TEMPLATE.replace("{previous JSON without the analysis}", JSON.stringify(readForCorrection(prev.read))).replace("{correction}", corr.text.replace(/"/g, "'")),
    });
  }
  const system: Anthropic.Messages.TextBlockParam[] = [{ type: "text", text: SHEET_SYSTEM, cache_control: { type: "ephemeral" } }];
  if (rules.prompt) system.push({ type: "text", text: rules.prompt });

  const model = fake() ? "stand-in" : PLAN_MODEL();
  const kind = corr ? "correct" : "read";
  let raw: unknown;
  let usage: Anthropic.Messages.Usage | null = null;
  let ms = 0;
  try {
    if (fake()) raw = fakeSheetRead(w, h, name, corr?.text, pdfText);
    else {
      const r = await streamForm<Record<string, unknown>>({
        model,
        maxTokens: 32000,
        system,
        content,
        schema: SHEET_SCHEMA as unknown as Record<string, unknown>,
        effort: "high",
        // A picture this size is never shrunk by any model, so it needs no guard.
        guardImages: !(Math.max(w, h) <= 1568 && w * h <= 1_150_000),
      });
      raw = r.data;
      usage = r.usage;
      ms = r.ms;
    }
  } catch (e) {
    const msg = e instanceof ClaudeStop ? e.message : friendlyClaudeError(e);
    await log(a, t, { sheet_id: sheet.id, sheet_name: name, kind, model, ok: false, error: e instanceof Error ? e.message : String(e), rules: rules.used.length });
    if (e instanceof ClaudeStop && e.kind === "oversized") return { ok: false, error: msg, resize: e.fit };
    return { ok: false, error: msg };
  }
  const read = cleanRead(raw, w, h);
  const cost = usage ? costCents(model, usage) : 0;
  const ai: SheetAi = { v: 1, at: new Date().toISOString(), model, w, h, px_per_pt: pxPerPt, read, rules: rules.used, cost_cents: cost, correction: corr?.text ?? null };
  const { error } = await a.supabase.from("takeoff_sheets").update({ ai, ai_at: ai.at }).eq("id", sheet.id);
  await log(a, t, { sheet_id: sheet.id, sheet_name: name, kind, model, ok: !error, error: error?.message, usage, ms, rules: rules.used.length, result: read });
  if (error) return { ok: false, error: `The reading didn't save: ${error.message}` };

  // The correction is kept; "remember" makes it a rule for every future reading.
  let rule: { id: string; text: string; builder: string | null } | null = null;
  if (corr) {
    const who = { created_by: a.user.id, created_by_name: a.profile.full_name || a.profile.email };
    const builder = corr.remember === "builder" ? (corr.builder?.trim() || t.builder?.trim() || "").slice(0, 80) || null : null;
    if (corr.remember === "all" || (corr.remember === "builder" && builder)) {
      const { data: r } = await a.supabase
        .from("takeoff_ai_rules")
        .insert({ text: corr.text, kind: "plans", builder, ops_company_id: t.ops_company_id, source: "correction", source_takeoff_id: t.id, source_sheet: name, ...who })
        .select("id, text, builder")
        .single<{ id: string; text: string; builder: string | null }>();
      rule = r ?? null;
      if (builder && !t.builder) await a.supabase.from("takeoffs").update({ builder }).eq("id", t.id);
    }
    await a.supabase.from("takeoff_ai_corrections").insert({
      takeoff_id: t.id,
      sheet_id: sheet.id,
      sheet_name: name,
      builder: builder ?? t.builder,
      text: corr.text,
      remember: rule ? corr.remember : "once",
      rule_id: rule?.id ?? null,
      ops_company_id: t.ops_company_id,
      ...who,
    });
  }
  return { ok: true, ai, rule };
}

const sheetsOf = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim().slice(0, 40)).filter(Boolean).slice(0, 20) : []);
const s = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const keyOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);

function cleanReconcile(raw: unknown): Reconciled {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const n = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null);
  const seen = new Set<string>();
  const disc: Discrepancy[] = [];
  for (const d of arr(r.discrepancies).slice(0, 40)) {
    const title = s(d.title, 140);
    if (!title) continue;
    let key = keyOf(title);
    while (seen.has(key)) key += "+";
    seen.add(key);
    disc.push({ key, title, detail: s(d.detail, 600), severity: (["high", "medium", "low"].includes(String(d.severity)) ? d.severity : "medium") as Discrepancy["severity"], sheets: sheetsOf(d.sheets) });
  }
  return {
    facts: arr(r.facts).slice(0, 40).map((f) => ({ topic: (FACT_TOPICS.includes(f.topic as never) ? f.topic : "other") as Reconciled["facts"][number]["topic"], value: s(f.value, 200), sheets: sheetsOf(f.sheets) })).filter((f) => f.value),
    heights: arr(r.heights).slice(0, 30).map((x) => ({ what: s(x.what, 80), height_ft: n(x.height_ft, 0.25, 60) ?? 0, sheets: sheetsOf(x.sheets) })).filter((x) => x.what && x.height_ft),
    pitches: arr(r.pitches).slice(0, 20).map((x) => ({ where: s(x.where, 80), rise: n(x.rise, 0.5, 30) ?? 0, sheets: sheetsOf(x.sheets) })).filter((x) => x.rise),
    components: arr(r.components).slice(0, 120).map((c) => ({
      kind: (COMPONENT_KINDS.includes(c.kind as never) ? c.kind : "window") as Reconciled["components"][number]["kind"],
      code: s(c.code, 30),
      width_ft: n(c.width_ft, 0.5, 40),
      height_ft: n(c.height_ft, 0.5, 30),
      qty: Math.max(1, Math.min(200, Math.round(Number(c.qty) || 1))),
      side: (SIDES.includes(c.side as never) ? c.side : "unknown") as Reconciled["components"][number]["side"],
      sheets: sheetsOf(c.sheets),
    })),
    discrepancies: disc,
    builder: s(r.builder, 80) || null,
    summary: s(r.summary, 800),
  };
}

/** Puts every sheet's reading together: merged windows, settled heights and pitches, and what disagrees. */
export async function reconcileAi(takeoffId: string): Promise<{ ok: true; ai: TakeoffAi } | { ok: false; error: string }> {
  const l = await load(takeoffId);
  if ("error" in l) return { ok: false, error: l.error };
  const { a, t } = l;
  const { data } = await a.supabase.from("takeoff_sheets").select("id, name, page, ft_per_pt, scale_label, ai").eq("takeoff_id", t.id).not("ai", "is", null).order("sort").order("page");
  const sheets = (data ?? []) as SheetRow[];
  if (!sheets.length) return { ok: false, error: "No sheets have been read yet." };
  const summaries = sheets.map((sh) => readSummary(sh.name || `Page ${sh.page}`, sh.ai!.read, sh.ft_per_pt ? sh.ai!.px_per_pt / Number(sh.ft_per_pt) : null));
  const rules = await rulesFor(a, t);
  const model = fake() ? "stand-in" : PLAN_MODEL();
  let raw: unknown;
  let usage: Anthropic.Messages.Usage | null = null;
  let ms = 0;
  try {
    if (fake()) raw = fakeReconcile(summaries.map((x) => x.sheet));
    else {
      const system: Anthropic.Messages.TextBlockParam[] = [{ type: "text", text: RECONCILE_SYSTEM }];
      if (rules.prompt) system.push({ type: "text", text: rules.prompt });
      const r = await streamForm<Record<string, unknown>>({
        model,
        maxTokens: 16000,
        system,
        content: [{ type: "text", text: `Plan set: ${t.name}${t.builder ? ` (builder: ${t.builder})` : ""}. Each sheet's reading:\n${JSON.stringify(summaries)}` }],
        schema: RECONCILE_SCHEMA as unknown as Record<string, unknown>,
        effort: "medium",
      });
      raw = r.data;
      usage = r.usage;
      ms = r.ms;
    }
  } catch (e) {
    await log(a, t, { kind: "reconcile", model, ok: false, error: e instanceof Error ? e.message : String(e), rules: rules.used.length });
    return { ok: false, error: e instanceof ClaudeStop ? e.message : friendlyClaudeError(e) };
  }
  const rec = cleanReconcile(raw);
  const prevChecked = new Set(t.ai_read?.checked ?? []);
  const ai: TakeoffAi = {
    at: new Date().toISOString(),
    model,
    reconcile: rec,
    checked: rec.discrepancies.map((d) => d.key).filter((k) => prevChecked.has(k)),
    cost_cents: usage ? costCents(model, usage) : 0,
    rules: rules.used.length,
  };
  const patch: Record<string, unknown> = { ai_read: ai };
  if (rec.builder && !t.builder) patch.builder = rec.builder;
  const { error } = await a.supabase.from("takeoffs").update(patch).eq("id", t.id);
  await log(a, t, { kind: "reconcile", model, ok: !error, error: error?.message, usage, ms, rules: rules.used.length, result: rec });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ai };
}

/** "Checked it" on an alert (or undo that). */
export async function checkAlert(takeoffId: string, key: string, checked: boolean): Promise<{ ok: boolean; checked?: string[] }> {
  const l = await load(takeoffId);
  if ("error" in l || !l.t.ai_read) return { ok: false };
  const cur = new Set(l.t.ai_read.checked ?? []);
  if (checked) cur.add(String(key).slice(0, 90));
  else cur.delete(String(key));
  const ai = { ...l.t.ai_read, checked: [...cur] };
  const { error } = await l.a.supabase.from("takeoffs").update({ ai_read: ai }).eq("id", l.t.id);
  return { ok: !error, checked: ai.checked };
}

/** The builder on this takeoff (rules can be remembered for one builder). */
export async function setTakeoffBuilder(takeoffId: string, builder: string): Promise<{ ok: boolean }> {
  const l = await load(takeoffId);
  if ("error" in l) return { ok: false };
  const { error } = await l.a.supabase.from("takeoffs").update({ builder: builder.trim().slice(0, 80) || null }).eq("id", l.t.id);
  revalidatePath(`/takeoff/${takeoffId}`);
  return { ok: !error };
}
