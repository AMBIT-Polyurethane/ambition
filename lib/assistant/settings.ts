import { cache } from "react";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, type AiSettings } from "@/lib/assistant/config";
import type { Profile } from "@/lib/types";

/** The assistant's settings, or null when supabase/migrations/0020_assistant.sql hasn't been run yet. */
export async function loadAiSettings(supabase: SupabaseClient): Promise<AiSettings | null> {
  const { data, error } = await supabase.from("ai_settings").select("*").maybeSingle<AiSettings>();
  if (error) return null;
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

export const aiKeySet = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

export function canUseAssistant(profile: Pick<Profile, "role" | "status">, settings: AiSettings | null): boolean {
  if (!settings || profile.status !== "active") return false;
  return profile.role === "employee" || profile.role === "admin" || settings.open_to_customers;
}

/** Does this person get Ask AMBIT in their menu and apps, and how many expert answers are waiting? */
// Asked by the menu and by the home screen on the same page load: worked out once per request.
export const assistantAccess = cache(async function assistantAccess(
  supabase: SupabaseClient,
  profile: Pick<Profile, "id" | "role" | "status">,
): Promise<{ on: boolean; unread: number }> {
  const staff = profile.role === "employee" || profile.role === "admin";
  if (profile.status !== "active") return { on: false, unread: 0 };
  // Both questions at once (the unread count is simply ignored when it's off).
  const [{ data, error }, { count }] = await Promise.all([
    supabase.from("ai_settings").select("open_to_customers").maybeSingle<{ open_to_customers: boolean }>(),
    supabase.from("ai_threads").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("unread", true),
  ]);
  if (error) return { on: false, unread: 0 };
  const on = staff || Boolean(data?.open_to_customers);
  return { on, unread: on ? count ?? 0 : 0 };
});
