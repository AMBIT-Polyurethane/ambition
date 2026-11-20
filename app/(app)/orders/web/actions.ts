"use server";

import { revalidatePath } from "next/cache";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";

/** Staff: move an ADC web order along (working on it, done, cancelled) with a note. */
export async function setAdcOrderStatus(f: FormData) {
  const { supabase, profile } = await requireActive();
  const id = Number(f.get("id"));
  const status = String(f.get("status") ?? "");
  if (!id || !["new", "working", "done", "cancelled"].includes(status)) return;
  const note = String(f.get("note") ?? "").trim().slice(0, 1000);
  await supabase
    .from("adc_orders")
    .update({ status, staff_note: note || null, handled_by: profile.id, handled_by_name: profile.full_name ?? profile.email, handled_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/orders/web");
}

export type PayState = { ok?: string; error?: string } | null;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** Staff: they paid. Saves what they paid, takes off AM-BUCKS they used, and posts the 3% they earned. */
export async function markAdcPaid(_: PayState, f: FormData): Promise<PayState> {
  const { supabase, profile } = await requireActive();
  if (!(profile.role === "admin" || can(profile, "order_desk"))) return { error: "Only the order desk can do this." };
  const id = Number(f.get("id"));
  const total = num(f.get("total"));
  const used = String(f.get("bucks") ?? "").trim() ? num(f.get("bucks")) : 0;
  if (!id) return { error: "Order not found." };
  if (!Number.isFinite(total) || total < 0) return { error: "Type what they paid for the goods, like 1250.00" };
  if (!Number.isFinite(used) || used < 0) return { error: "AM-BUCKS used should be a dollar amount, like 24.00 (or leave it empty)." };
  const { data, error } = await supabase.rpc("adc_order_mark_paid", { p_id: id, p_total: total, p_bucks_used: used, p_note: String(f.get("note") ?? "") });
  if (error) return { error: error.message.replace(/^.*?: /, "") || "Could not save that." };
  revalidatePath("/orders/web");
  const r = (data ?? {}) as { points?: number; account?: boolean; used?: number };
  if (!r.account) return { ok: "Marked paid. They have no ADC account, so no AM-BUCKS were posted." };
  return { ok: `Marked paid. ${r.points ?? 0} points posted ($${((r.points ?? 0) / 100).toFixed(2)} in AM-BUCKS)${r.used ? `, ${r.used} points used` : ""}.` };
}

/** Staff: flag a web order as a test (it never counts for AM-BUCKS or reports). */
export async function setAdcTest(f: FormData) {
  const { supabase, profile } = await requireActive();
  if (!(profile.role === "admin" || can(profile, "order_desk"))) return;
  const id = Number(f.get("id"));
  if (!id) return;
  await supabase.from("adc_orders").update({ is_test: f.get("on") === "1" }).eq("id", id);
  revalidatePath("/orders/web");
}

/** Admins: remove a test (or cancelled) web order for good. */
export async function deleteAdcTest(f: FormData) {
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin") return;
  const id = Number(f.get("id"));
  if (!id) return;
  await supabase.rpc("adc_order_delete_test", { p_id: id });
  revalidatePath("/orders/web");
}
