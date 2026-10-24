"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/**
 * Deletes the signed-in person's login and profile for good. Orders they placed stay on file for AMBIT
 * (they keep the name, email and phone they were sent with). The last admin can't delete themselves.
 */
export async function deleteMyAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await getSession();
  if (!s) return { error: "Please sign in again." };
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    return { error: "Type DELETE in the box to confirm." };
  }
  const { error } = await s.supabase.rpc("delete_my_account");
  if (error) {
    if (/LAST_ADMIN/.test(error.message)) {
      return { error: "You're the only admin. Make someone else an admin in Admin → Accounts first, then delete your account." };
    }
    if (/function .*delete_my_account|could not find/i.test(error.message)) {
      return { error: "Account deletion isn't switched on yet (the database update hasn't been run). Please try again later." };
    }
    return { error: "Your account couldn't be deleted. Please try again or email orders@ambitpu.com." };
  }
  // The login is gone; clear this device's session cookies too.
  await s.supabase.auth.signOut().catch(() => undefined);
  redirect("/signin?deleted=1");
}

/** Saves the person's home-screen app layout (order and hidden apps). Pass nothing to go back to the default. */
export async function saveHomeApps(layout: { order: string[]; hidden: string[] } | null): Promise<FormState> {
  const s = await getSession();
  if (!s?.profile) return { error: "Please sign in again." };
  const clean = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === "string" && k.length < 80).slice(0, 100) : []);
  const value = layout ? { order: clean(layout.order), hidden: clean(layout.hidden) } : null;
  const { error } = await s.supabase.from("profiles").update({ home_apps: value }).eq("id", s.profile.id);
  if (error) {
    return { error: /home_apps/.test(error.message) ? "Saving your layout isn't switched on yet (the database update hasn't been run)." : error.message };
  }
  revalidatePath("/");
  return { ok: "Saved. Your home screen is updated." };
}
