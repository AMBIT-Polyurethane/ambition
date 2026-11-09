import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Copies a takeoff with everything in it: plan files (copied in storage), sheets (with their AI readings),
// items, shapes, and windows and doors. Used for templates (save one, start a new takeoff from one): no AI
// call is needed, the copy is checked and adjusted.

type Fields = {
  name: string;
  customer?: string | null;
  address?: string | null;
  due_date?: string | null;
  is_template: boolean;
  template_name?: string | null;
  from_template?: string | null;
  ops_company_id: string | null;
  lead_id?: string | null;
  ops_customer_id?: string | null;
  created_by: string;
  created_by_name: string;
};

/** A row without some columns (they're filled in again: created_at gets now()). */
const without = (r: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function copyTakeoff(db: SupabaseClient, srcId: string, f: Fields): Promise<{ id: string } | { error: string }> {
  const { data: src } = await db.from("takeoffs").select("id, builder, notes, ai_scan, ai_read, ops_company_id").eq("id", srcId).maybeSingle();
  if (!src) return { error: "That takeoff or template isn't there any more." };
  const [{ data: files }, { data: sheets }, { data: items }, { data: comps }] = await Promise.all([
    db.from("takeoff_files").select("*").eq("takeoff_id", srcId),
    db.from("takeoff_sheets").select("*").eq("takeoff_id", srcId),
    db.from("takeoff_items").select("*").eq("takeoff_id", srcId),
    db.from("takeoff_components").select("*").eq("takeoff_id", srcId).range(0, 4999),
  ]);
  const marks: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("takeoff_marks").select("*").eq("takeoff_id", srcId).order("created_at").range(from, from + 999);
    marks.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }

  const { data: made, error } = await db
    .from("takeoffs")
    .insert({ ...f, builder: src.builder, notes: f.is_template ? src.notes : null, ai_scan: src.ai_scan, ai_read: src.ai_read })
    .select("id")
    .single<{ id: string }>();
  if (error || !made) return { error: error?.message ?? "Couldn't make the copy." };
  const id = made.id;
  const fail = async (msg: string) => {
    await db.from("takeoffs").delete().eq("id", id);
    return { error: msg };
  };

  // Plan files: copied in storage under the new takeoff.
  const fileId = new Map<string, string>();
  for (const fl of (files ?? []) as { id: string; path: string; file_name: string; size: number | null; pages: number | null }[]) {
    const path = `${id}/${crypto.randomUUID()}.pdf`;
    const cp = await db.storage.from("plans").copy(fl.path, path);
    if (cp.error) return fail(`The plan file ${fl.file_name} didn't copy: ${cp.error.message}`);
    const nid = crypto.randomUUID();
    const { error: e } = await db.from("takeoff_files").insert({ id: nid, takeoff_id: id, path, file_name: fl.file_name, size: fl.size, pages: fl.pages });
    if (e) return fail(e.message);
    fileId.set(fl.id, nid);
  }
  const sheetId = new Map<string, string>();
  const sheetRows = ((sheets ?? []) as Record<string, unknown>[]).map((s) => {
    const nid = crypto.randomUUID();
    sheetId.set(String(s.id), nid);
    return { ...s, id: nid, takeoff_id: id, file_id: fileId.get(String(s.file_id)) };
  });
  for (const c of chunk(sheetRows, 200)) {
    const { error: e } = await db.from("takeoff_sheets").insert(c);
    if (e) return fail(e.message);
  }
  const itemId = new Map<string, string>();
  const itemRows = ((items ?? []) as Record<string, unknown>[]).map((i) => {
    const nid = crypto.randomUUID();
    itemId.set(String(i.id), nid);
    return { ...without(i, "created_at"), id: nid, takeoff_id: id };
  });
  for (const c of chunk(itemRows, 300)) {
    const { error: e } = await db.from("takeoff_items").insert(c);
    if (e) return fail(e.message);
  }
  const markRows = marks
    .filter((m) => itemId.has(String(m.item_id)) && sheetId.has(String(m.sheet_id)))
    .map((m) => ({ ...without(m, "created_at"), id: crypto.randomUUID(), takeoff_id: id, item_id: itemId.get(String(m.item_id)), sheet_id: sheetId.get(String(m.sheet_id)) }));
  for (const c of chunk(markRows, 500)) {
    const { error: e } = await db.from("takeoff_marks").insert(c);
    if (e) return fail(e.message);
  }
  const compRows = ((comps ?? []) as Record<string, unknown>[]).map((c) => ({ ...without(c, "created_at"), id: crypto.randomUUID(), takeoff_id: id, sheet_id: c.sheet_id ? sheetId.get(String(c.sheet_id)) ?? null : null }));
  for (const c of chunk(compRows, 500)) await db.from("takeoff_components").insert(c);
  return { id };
}
