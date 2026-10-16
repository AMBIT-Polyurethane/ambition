"use server";

import { revalidatePath } from "next/cache";
import { getSession, isEmployee } from "@/lib/session";
import { sendOrderEmail } from "@/lib/order-send";

const STATUSES = ["new", "processing", "completed", "cancelled"];

export async function setOrderStatus(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!STATUSES.includes(status)) return;
  await s.supabase.from("orders").update({ status }).eq("id", id);
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}

export async function resendOrderEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  await sendOrderEmail(s.supabase, id);
  revalidatePath(`/orders/${id}`);
}
