"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { parseHomeLayout, type HomeLayout } from "@/lib/home-board";
import { outlookDisconnect } from "@/lib/outlook";

/** Customize Home: save the order of the cards and which ones are hidden (on the profile, so it follows the person). */
export async function saveHomeLayout(layout: HomeLayout): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const value = parseHomeLayout(layout);
  if (!value) return { ok: false, error: "That layout didn't look right." };
  const { error } = await s.supabase.from("profiles").update({ home_layout: value }).eq("id", s.profile.id);
  if (error) return { ok: false, error: /home_layout/.test(error.message) ? "Saving your layout needs the latest database update." : error.message };
  revalidatePath("/");
  return { ok: true };
}

/** Outlook card: forget this person's Microsoft connection. */
export async function disconnectOutlook() {
  const s = await getSession();
  if (!s?.profile) return;
  await outlookDisconnect(s.profile.id);
  revalidatePath("/");
}
