"use server";

import { revalidatePath } from "next/cache";
import { requireActive } from "@/lib/session";

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
