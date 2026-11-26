"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

export type MySmsRes = { ok: true; msg: string } | { ok: false; error: string };

/** Profile: my mobile, and whether I want texts (staff: alerts; contractors: order updates). */
export async function saveMySms(i: { phone: string; on: boolean }): Promise<MySmsRes> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const { data, error } = await s.supabase.rpc("my_sms", { p_phone: i.phone, p_on: i.on });
  if (error) return { ok: false, error: /my_sms|function/i.test(error.message) && /does not exist|schema cache/i.test(error.message) ? "Texts need database update 0118 first." : error.message.replace(/^.*?ERROR:\s*/, "") };
  revalidatePath("/profile");
  return { ok: true, msg: String(data).replace(/\+1(\d{3})(\d{3})(\d{4})/g, "($1) $2-$3") };
}
