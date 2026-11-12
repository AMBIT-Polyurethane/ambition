import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_HOLIDAYS, readHolidaySettings, type HolidaySettings } from "@/lib/holidays";

/** Admin > Holidays (app_settings "holidays"); the defaults until it's saved or before migration 0063. */
export async function holidaySettings(db: SupabaseClient): Promise<HolidaySettings> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", "holidays").maybeSingle();
  return error || !data ? DEFAULT_HOLIDAYS : readHolidaySettings(data.value);
}
