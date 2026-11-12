"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { holidaySettings } from "@/lib/holidays-server";
import type { HolidaySettings } from "@/lib/holidays";

async function save(next: HolidaySettings, msg: string) {
  const { supabase, profile } = await requireAdmin();
  const { error } = await supabase.from("app_settings").upsert({ key: "holidays", value: next, updated_at: new Date().toISOString(), updated_by_name: profile.full_name ?? profile.email });
  revalidatePath("/", "layout");
  redirect(`/admin/holidays?${error ? `err=${encodeURIComponent(/app_settings/.test(error.message) ? "This needs the 0063 database update first." : error.message)}` : `msg=${encodeURIComponent(msg)}`}`);
}

export async function saveHolidays(form: FormData) {
  const { supabase } = await requireAdmin();
  const cur = await holidaySettings(supabase);
  await save({ ...cur, touches: form.get("touches") === "on", closed: form.getAll("closed").map(String) }, "Saved.");
}

export async function addClosedDay(form: FormData) {
  const { supabase } = await requireAdmin();
  const cur = await holidaySettings(supabase);
  const date = String(form.get("date") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || "Closed";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect("/admin/holidays?err=Pick%20the%20day.");
  await save({ ...cur, extra: [...cur.extra.filter((e) => e.date !== date), { date, name }].sort((a, b) => a.date.localeCompare(b.date)) }, "Added.");
}

export async function removeClosedDay(form: FormData) {
  const { supabase } = await requireAdmin();
  const cur = await holidaySettings(supabase);
  const date = String(form.get("date") ?? "");
  await save({ ...cur, extra: cur.extra.filter((e) => e.date !== date) }, "Removed.");
}
