"use server";

import { revalidatePath } from "next/cache";
import { getSession, isEmployee } from "@/lib/session";

// Order texts (0118): staff set the customer mobile that gets this order's texts.
export type SmsRes = { ok: true; msg: string } | { ok: false; error: string };
const clean = (m: string) => (/order_set_sms|sms_|function/i.test(m) && /does not exist|schema cache/i.test(m) ? "Texting needs database update 0118 first (Supabase > SQL Editor)." : m.replace(/^.*?ERROR:\s*/, ""));

export async function setOrderSms(i: { order: string; phone: string; agreed: boolean }): Promise<SmsRes> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return { ok: false, error: "Staff only." };
  const { data, error } = await s.supabase.rpc("order_set_sms", { p_order: i.order, p_phone: i.phone, p_agreed: i.agreed });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath(`/orders/${i.order}`);
  return { ok: true, msg: String(data).replace(/\+1(\d{3})(\d{3})(\d{4})/g, "($1) $2-$3") };
}
