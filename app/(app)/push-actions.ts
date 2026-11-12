"use server";

import { requireActive } from "@/lib/session";
import { pushPublicKey, sendPush } from "@/lib/push";

// Turning phone notifications on and off for this phone or computer (0063).

export async function pushKey(): Promise<string | null> {
  await requireActive();
  return pushPublicKey();
}

export async function savePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase, profile } = await requireActive();
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: "That browser didn't give a usable subscription." };
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  const { error } = await supabase
    .from("push_subscriptions")
    .insert({ user_id: profile.id, endpoint: sub.endpoint.slice(0, 1000), p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100), device: device.slice(0, 120) });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removePush(endpoint: string): Promise<void> {
  const { supabase } = await requireActive();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** "Send me a test" so people can see it works. */
export async function testPush(): Promise<{ sent: number }> {
  const { profile } = await requireActive();
  const sent = await sendPush([profile.id], { title: "AMBIT Intelligence", body: "Notifications are on for this device.", url: "/chat", tag: "test" });
  return { sent };
}
