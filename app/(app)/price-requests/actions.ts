"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { normName } from "@/lib/jotform";

/** Admin: "this name on the form is this person in the app". */
export async function linkRepName(form: FormData) {
  const { supabase } = await requireAdmin();
  const repName = normName(String(form.get("rep_name") ?? ""));
  const profileId = String(form.get("profile_id") ?? "");
  if (!repName || !profileId) return;
  await supabase.from("rep_name_links").upsert({ rep_name: repName, profile_id: profileId }, { onConflict: "rep_name" });
  revalidatePath("/price-requests");
}

export async function unlinkRepName(form: FormData) {
  const { supabase } = await requireAdmin();
  const repName = normName(String(form.get("rep_name") ?? ""));
  if (!repName) return;
  await supabase.from("rep_name_links").delete().eq("rep_name", repName);
  revalidatePath("/price-requests");
}
