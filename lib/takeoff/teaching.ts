import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TakeoffAccess } from "@/lib/takeoff/access";
import { ASSEMBLIES } from "@/lib/takeoff/assemblies";
import { CORRECTION_TEMPLATE, PROMPT_VERSION, RECONCILE_SCHEMA, RECONCILE_SYSTEM, SHEET_SCHEMA, SHEET_SYSTEM } from "@/lib/takeoff/ai-prompts";

// Everything the takeoff AI has been taught, as one versioned download another app can import (and a
// Markdown copy people can read), and reading such a file back in (AMBIT's own, or PRO-Rate's).

export const EXPORT_FORMAT = "ambit-takeoff-teaching";
export const EXPORT_VERSION = 1;

/** Whose rules: AMBIT's (null) for staff, the contractor's company otherwise. */
export function rulesScope(a: TakeoffAccess, ops: boolean): string | null {
  if (a.staff && !(ops && a.ws)) return null;
  return a.ws?.company.id ?? null;
}

export type RuleRow = {
  id: string;
  text: string;
  kind: "plans" | "photos";
  builder: string | null;
  active: boolean;
  source: string;
  source_takeoff_id: string | null;
  source_sheet: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  takeoff?: { name: string } | null;
};
export type CorrectionRow = {
  id: string;
  takeoff_id: string | null;
  sheet_name: string | null;
  builder: string | null;
  text: string;
  remember: string;
  rule_id: string | null;
  created_by_name: string | null;
  created_at: string;
  takeoff?: { name: string } | null;
};

export async function loadTeaching(db: SupabaseClient, scope: string | null) {
  let rq = db.from("takeoff_ai_rules").select("*, takeoff:takeoffs!takeoff_ai_rules_source_takeoff_id_fkey(name)").order("created_at").limit(5000);
  let cq = db.from("takeoff_ai_corrections").select("*, takeoff:takeoffs(name)").order("created_at", { ascending: false }).limit(5000);
  rq = scope ? rq.eq("ops_company_id", scope) : rq.is("ops_company_id", null);
  cq = scope ? cq.eq("ops_company_id", scope) : cq.is("ops_company_id", null);
  const [{ data: rules }, { data: corrections }] = await Promise.all([rq, cq]);
  return { rules: (rules ?? []) as RuleRow[], corrections: (corrections ?? []) as CorrectionRow[] };
}

/** The download: rules, every correction, the assembly catalog and (for AMBIT) the base instructions. */
export function teachingJson(t: { rules: RuleRow[]; corrections: CorrectionRow[] }, opts: { scopeName: string; withPrompts: boolean }) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    app: "AMBIT Intelligence",
    scope: opts.scopeName,
    prompt_version: PROMPT_VERSION,
    rules: t.rules.map((r) => ({
      id: r.id,
      text: r.text,
      applies_to: r.kind === "photos" ? "site photos" : "plans",
      scope: r.builder ? r.builder : "all builders",
      builder: r.builder,
      active: r.active,
      source: r.source,
      learned_on: r.takeoff?.name ?? null,
      sheet: r.source_sheet,
      created_by: r.created_by_name,
      created_at: r.created_at,
    })),
    corrections: t.corrections.map((c) => ({
      text: c.text,
      sheet: c.sheet_name,
      takeoff: c.takeoff?.name ?? null,
      builder: c.builder,
      remembered: c.remember === "once" ? "just this time" : c.remember === "all" ? "all plans" : "this builder",
      rule_id: c.rule_id,
      created_by: c.created_by_name,
      created_at: c.created_at,
    })),
    assemblies: ASSEMBLIES.map((a) => ({
      key: a.key,
      number: a.n,
      name: a.label,
      between: a.between,
      measured_as: a.measure === "line" ? "line × height" : a.measure === "area" ? "area" : "sloped area (× pitch factor)",
      definition: a.what,
      default_height_ft: a.height ?? null,
      default_pitch: a.pitch ?? null,
    })),
    base_instructions: opts.withPrompts
      ? { sheet: SHEET_SYSTEM, correction: CORRECTION_TEMPLATE, reconcile: RECONCILE_SYSTEM, sheet_schema: SHEET_SCHEMA, reconcile_schema: RECONCILE_SCHEMA }
      : null,
  };
}

export function teachingMarkdown(j: ReturnType<typeof teachingJson>): string {
  const d = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const lines: string[] = [];
  lines.push(`# Takeoff AI teaching: ${j.scope}`, "", `Exported ${d(j.exported_at)} from AMBIT Intelligence (format ${j.format} v${j.version}, prompts ${j.prompt_version}).`, "");
  const on = j.rules.filter((r) => r.active);
  const off = j.rules.filter((r) => !r.active);
  lines.push(`## Rules (${on.length} in use${off.length ? `, ${off.length} switched off` : ""})`, "");
  const groups = new Map<string, typeof on>();
  for (const r of on) groups.set(r.scope, [...(groups.get(r.scope) ?? []), r]);
  for (const [scope, list] of [...groups.entries()].sort((a, b) => (a[0] === "all builders" ? -1 : b[0] === "all builders" ? 1 : a[0].localeCompare(b[0])))) {
    lines.push(`### ${scope === "all builders" ? "All plans" : `Builder: ${scope}`}`, "");
    list.forEach((r, i) => lines.push(`${i + 1}. ${r.text}${r.applies_to !== "plans" ? " *(site photos)*" : ""}${r.learned_on ? ` *(learned on ${r.learned_on}${r.sheet ? `, ${r.sheet}` : ""})*` : ""}`));
    lines.push("");
  }
  if (off.length) {
    lines.push("### Switched off", "");
    off.forEach((r) => lines.push(`- ${r.text}`));
    lines.push("");
  }
  lines.push(`## Corrections (${j.corrections.length})`, "");
  for (const c of j.corrections.slice(0, 500)) lines.push(`- ${d(c.created_at)}${c.takeoff ? ` · ${c.takeoff}` : ""}${c.sheet ? ` · ${c.sheet}` : ""} (${c.remembered}): ${c.text}`);
  lines.push("", "## Assemblies", "", "| # | Assembly | Between | Measured as | What it is |", "|---|---|---|---|---|");
  for (const a of j.assemblies) lines.push(`| ${a.number} | ${a.name} | ${a.between} | ${a.measured_as} | ${a.definition.replace(/\|/g, "/")} |`);
  if (j.base_instructions) {
    lines.push("", "## Base instructions", "", "### Reading one sheet", "", "```", j.base_instructions.sheet, "```", "", "### A correction", "", "```", j.base_instructions.correction, "```", "", "### Checking the sheets against each other", "", "```", j.base_instructions.reconcile, "```");
  }
  return lines.join("\n") + "\n";
}

export type ImportedRule = { text: string; kind: "plans" | "photos"; builder: string | null; active: boolean };

/**
 * Rules out of a teaching export: AMBIT's own, or PRO-Rate's (rules[] with text, applies_to "plans" or
 * "site photos", scope "all builders" or a builder's name, active). Field names are read loosely.
 */
export function parseTeachingImport(raw: unknown): { from: string; rules: ImportedRule[]; corrections: number } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(o.rules) ? o.rules : Array.isArray(raw) ? (raw as unknown[]) : [];
  const from = typeof o.app === "string" && o.app.trim() ? o.app.trim().slice(0, 40) : o.format === EXPORT_FORMAT ? "AMBIT Intelligence" : "PRO-Rate";
  const rules: ImportedRule[] = [];
  for (const x of list.slice(0, 2000)) {
    const r = (typeof x === "string" ? { text: x } : (x ?? {})) as Record<string, unknown>;
    const text = String(r.text ?? r.rule ?? r.content ?? r.body ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!text) continue;
    const applies = String(r.applies_to ?? r.kind ?? r.type ?? "plans").toLowerCase();
    const scopeRaw = String(r.builder ?? r.builder_name ?? r.scope ?? "").trim();
    const builder = !scopeRaw || /^(all|all builders|every builder|global|any)$/i.test(scopeRaw) ? null : scopeRaw.replace(/^builder:\s*/i, "").slice(0, 80);
    const active = !(r.active === false || r.enabled === false || r.active === "false" || String(r.status ?? "").toLowerCase() === "off");
    rules.push({ text, kind: /photo/.test(applies) ? "photos" : "plans", builder, active });
  }
  return { from, rules, corrections: Array.isArray(o.corrections) ? o.corrections.length : 0 };
}
