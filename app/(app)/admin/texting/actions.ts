"use server";

import { requireAdmin } from "@/lib/session";
import { sendSms } from "@/lib/sms";
import { revalidatePath } from "next/cache";

export async function sendTestText(_prev: { ok: boolean; msg: string } | null, form: FormData): Promise<{ ok: boolean; msg: string }> {
  const { profile } = await requireAdmin();
  const to = String(form.get("to") ?? "");
  const r = await sendSms({ to, kind: "test", userId: profile.id, body: `AMBIT Intelligence: test text from ${profile.full_name ?? "an admin"}. Texting works.` });
  revalidatePath("/admin/texting");
  if (r.status === "sent") return { ok: true, msg: "Sent. It should arrive in a few seconds (the log below shows when it's delivered)." };
  return { ok: false, msg: r.error ?? r.status };
}
