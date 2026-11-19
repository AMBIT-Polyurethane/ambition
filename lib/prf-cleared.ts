import type { SupabaseClient } from "@supabase/supabase-js";

/** Jotform price requests still waiting this many days can be removed from the app's lists in one click. */
export const OLD_DAYS = 89;

/** Jotform dates are "YYYY-MM-DD HH:MM:SS" (Central). */
export const jfMs = (v: string) => new Date(v.includes("T") ? v : v.replace(" ", "T") + "-06:00").getTime();

/** Waiting requests sent on or before this moment were removed (app_settings "prf_cleared"). They stay in Jotform. */
export async function prfClearedBefore(db: SupabaseClient): Promise<number | null> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", "prf_cleared").maybeSingle<{ value: { before?: string } }>();
  if (error || !data?.value?.before) return null;
  const t = new Date(data.value.before).getTime();
  return Number.isFinite(t) ? t : null;
}

export const isCleared = (i: { status?: string; created_at: string }, before: number | null) =>
  before !== null && i.status === "pending" && jfMs(i.created_at) <= before;
