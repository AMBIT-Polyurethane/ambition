"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import type { FormState } from "@/app/(auth)/actions";

export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await getSession();
  if (!s?.profile) return { error: "Please sign in again." };
  const val = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v ? v.slice(0, 200) : null;
  };
  const { error } = await s.supabase
    .from("profiles")
    .update({ full_name: val("full_name"), phone: val("phone"), title: val("title"), branch_id: val("branch_id") })
    .eq("id", s.profile.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}
