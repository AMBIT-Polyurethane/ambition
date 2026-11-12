"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { can, hubAllows } from "@/lib/access";

// Partial receipts (0065): part of a PO came in; the rest becomes an expected delivery, listed under
// Receiving > "Waiting on the rest of the order" until it arrives.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type R = { ok: true; id?: number } | { ok: false; error: string };
const NEEDS = "Partial receipts need the 0065 database update first. Ask Jeremiah to run it.";

export async function markPartial(input: { id: number; expected: string; note: string; lines: { product_id: string; qty: number }[] }): Promise<R> {
  const s = await getSession();
  if (!s?.profile || !(can(s.profile, "receiving") || can(s.profile, "inventory"))) return { ok: false, error: "You don't have access to receiving." };
  const { data: d } = await s.supabase.from("inbound_deliveries").select("branch_id").eq("id", input.id).maybeSingle();
  if (!d || !hubAllows(s.profile, d.branch_id as string)) return { ok: false, error: "Receiving Report not found." };
  const lines = input.lines.filter((l) => UUID.test(l.product_id) && Number(l.qty) > 0).map((l) => ({ product_id: l.product_id, qty: Math.round(Number(l.qty) * 100) / 100 }));
  if (!lines.length) return { ok: false, error: "Add what's still coming (and how many)." };
  const { data, error } = await s.supabase.rpc("inbound_mark_partial", {
    p_id: input.id,
    p_expected: /^\d{4}-\d{2}-\d{2}$/.test(input.expected) ? input.expected : null,
    p_note: input.note.trim().slice(0, 500) || null,
    p_lines: lines,
  });
  if (error) return { ok: false, error: /inbound_mark_partial|function|schema cache/i.test(error.message) ? NEEDS : error.message };
  revalidatePath("/inventory", "layout");
  return { ok: true, id: Number(data) };
}

export async function unmarkPartial(id: number): Promise<R> {
  const s = await getSession();
  if (!s?.profile || !(can(s.profile, "receiving") || can(s.profile, "inventory"))) return { ok: false, error: "You don't have access to receiving." };
  const { error } = await s.supabase.rpc("inbound_unmark_partial", { p_id: id });
  if (error) return { ok: false, error: /inbound_unmark_partial|function|schema cache/i.test(error.message) ? NEEDS : error.message };
  revalidatePath("/inventory", "layout");
  return { ok: true };
}
