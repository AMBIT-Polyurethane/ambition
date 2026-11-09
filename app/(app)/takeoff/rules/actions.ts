"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { takeoffAccess } from "@/lib/takeoff/access";
import { parseTeachingImport, rulesScope } from "@/lib/takeoff/teaching";

// The rules the takeoff AI follows: added by hand, from corrections, or imported (PRO-Rate's export).
// AMBIT staff manage AMBIT's rules (every takeoff); a contractor manages their own company's.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: FormDataEntryValue | null, n: number) => String(v ?? "").trim().slice(0, n);

function back(ops: boolean, kind: "msg" | "err", text: string): never {
  revalidatePath("/takeoff/rules");
  redirect(`/takeoff/rules?${ops ? "ops=1&" : ""}${kind}=${encodeURIComponent(text)}`);
}

async function who() {
  const a = await takeoffAccess();
  if (!a) redirect("/");
  return a;
}

export async function addRule(form: FormData) {
  const a = await who();
  const ops = form.get("ops") === "1";
  const text = clip(form.get("text"), 2000);
  if (!text) back(ops, "err", "Type the rule.");
  const builder = form.get("scope") === "builder" ? clip(form.get("builder"), 80) || null : null;
  if (form.get("scope") === "builder" && !builder) back(ops, "err", "Type the builder's name, or pick All plans.");
  const { error } = await a.supabase.from("takeoff_ai_rules").insert({
    text,
    kind: form.get("kind") === "photos" ? "photos" : "plans",
    builder,
    ops_company_id: rulesScope(a, ops),
    source: "manual",
    created_by: a.user.id,
    created_by_name: a.profile.full_name || a.profile.email,
  });
  back(ops, error ? "err" : "msg", error ? error.message : "Rule added. The AI follows it from the next reading on.");
}

export async function saveRule(form: FormData) {
  const a = await who();
  const ops = form.get("ops") === "1";
  const id = clip(form.get("id"), 40);
  const text = clip(form.get("text"), 2000);
  if (!UUID.test(id) || !text) back(ops, "err", "Type the rule.");
  const builder = form.get("scope") === "builder" ? clip(form.get("builder"), 80) || null : null;
  const { error } = await a.supabase
    .from("takeoff_ai_rules")
    .update({ text, builder, kind: form.get("kind") === "photos" ? "photos" : "plans", updated_at: new Date().toISOString() })
    .eq("id", id);
  back(ops, error ? "err" : "msg", error ? error.message : "Rule saved.");
}

/** Switch a rule off (kept, not used) or back on. */
export async function toggleRule(form: FormData) {
  const a = await who();
  const ops = form.get("ops") === "1";
  const id = clip(form.get("id"), 40);
  if (!UUID.test(id)) return;
  const on = form.get("on") === "1";
  const { error } = await a.supabase.from("takeoff_ai_rules").update({ active: on, updated_at: new Date().toISOString() }).eq("id", id);
  back(ops, error ? "err" : "msg", error ? error.message : on ? "Rule switched on." : "Rule switched off. It's kept, but the AI doesn't use it.");
}

export async function deleteRule(form: FormData) {
  const a = await who();
  const ops = form.get("ops") === "1";
  const id = clip(form.get("id"), 40);
  if (!UUID.test(id)) return;
  const { error } = await a.supabase.from("takeoff_ai_rules").delete().eq("id", id);
  back(ops, error ? "err" : "msg", error ? error.message : "Rule deleted.");
}

/** Brings in rules from a teaching export (AMBIT's, or PRO-Rate's Rules page → Export JSON). */
export async function importRules(form: FormData) {
  const a = await who();
  const ops = form.get("ops") === "1";
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) back(ops, "err", "Pick the exported JSON file.");
  if (file.size > 5_000_000) back(ops, "err", "That file is too big for a rules export (5 MB at most).");
  let parsed: ReturnType<typeof parseTeachingImport>;
  try {
    parsed = parseTeachingImport(JSON.parse(await file.text()));
  } catch {
    back(ops, "err", "That file isn't a JSON export. On PRO-Rate's Rules page use Export (JSON).");
  }
  if (!parsed.rules.length) back(ops, "err", "No rules found in that file.");
  const scope = rulesScope(a, ops);
  let q = a.supabase.from("takeoff_ai_rules").select("text, builder, kind").limit(5000);
  q = scope ? q.eq("ops_company_id", scope) : q.is("ops_company_id", null);
  const { data: have } = await q;
  const key = (r: { text: string; builder: string | null; kind: string }) => `${r.kind}|${(r.builder ?? "").trim().toLowerCase()}|${r.text.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const seen = new Set(((have ?? []) as { text: string; builder: string | null; kind: string }[]).map(key));
  const fresh = parsed.rules.filter((r) => {
    const k = key(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const by = { created_by: a.user.id, created_by_name: a.profile.full_name || a.profile.email };
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await a.supabase.from("takeoff_ai_rules").insert(
      fresh.slice(i, i + 200).map((r) => ({ text: r.text, kind: r.kind, builder: r.builder, active: r.active, ops_company_id: scope, source: "import", source_sheet: parsed.from, ...by })),
    );
    if (error) back(ops, "err", error.message);
  }
  const skipped = parsed.rules.length - fresh.length;
  back(
    ops,
    "msg",
    `Imported ${fresh.length} rule${fresh.length === 1 ? "" : "s"} from ${parsed.from}${skipped ? ` (${skipped} already here)` : ""}${fresh.some((r) => !r.active) ? "; the ones switched off there are off here too" : ""}.`,
  );
}
