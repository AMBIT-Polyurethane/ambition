"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { sendEmail, wrapEmail } from "@/lib/email";
import { escapeHtml as h } from "@/lib/format";
import { currentOrigin } from "@/lib/origin";
import { kindLabel, statusOf } from "@/lib/feedback";

// Feedback (0117): admins send it; Jeremiah sets where it stands and answers. Both sides get an email.

export type FbRes = { ok: true; msg: string } | { ok: false; error: string };
const clean = (m: string) =>
  /feedback_(send|answer|seen)|relation "public.feedback"|feedback_settings/i.test(m) && /does not exist|schema cache|function/i.test(m)
    ? "Feedback needs database update 0117 first (Supabase > SQL Editor)."
    : m.replace(/^.*?ERROR:\s*/, "");

export async function sendFeedback(i: { kind: string; area: string; subject: string; body: string }): Promise<FbRes> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const { data, error } = await s.supabase.rpc("feedback_send", { p_kind: i.kind, p_area: i.area, p_subject: i.subject, p_body: i.body });
  if (error) return { ok: false, error: clean(error.message) };
  // Tell the inbox owner. Never holds up the send.
  try {
    const { data: set } = await s.supabase.from("feedback_settings").select("owner_id").eq("id", 1).maybeSingle<{ owner_id: string | null }>();
    const { data: owner } = set?.owner_id
      ? await s.supabase.from("profiles").select("email").eq("id", set.owner_id).maybeSingle<{ email: string }>()
      : { data: null };
    if (owner?.email && set?.owner_id !== s.profile.id) {
      const link = `${await currentOrigin()}/feedback?inbox=1#f-${data}`;
      const who = s.profile.full_name ?? s.profile.email;
      const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">${h(kindLabel(i.kind).toUpperCase())}${i.area ? ` · ${h(i.area.toUpperCase())}` : ""}</div>
<div style="font-size:22px;font-weight:800;margin:4px 0 12px;">${h(i.subject.trim())}</div>
<p style="font-size:15px;margin:0 0 12px;line-height:1.55;white-space:pre-wrap;">${h(i.body.trim())}</p>
<p style="font-size:13px;margin:0;color:#52525b;">From ${h(who)}</p>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">ANSWER IT</a></p>`;
      await sendEmail({ to: [owner.email], subject: `Feedback: ${kindLabel(i.kind)} from ${who} · ${i.subject.trim().slice(0, 80)}`, html: wrapEmail("Feedback", inner), text: `${kindLabel(i.kind)} from ${who}\n\n${i.subject}\n\n${i.body}\n\n${link}` });
    }
  } catch {
    /* email is a courtesy */
  }
  revalidatePath("/feedback");
  return { ok: true, msg: "Sent. It went straight to Jeremiah, and his answer shows up here (you'll get an email too)." };
}

export async function answerFeedback(i: { id: number; status: string; reply: string }): Promise<FbRes> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const { data, error } = await s.supabase.rpc("feedback_answer", { p_id: i.id, p_status: i.status, p_reply: i.reply });
  if (error) return { ok: false, error: clean(error.message) };
  if (data === "answered") {
    try {
      const { data: f } = await s.supabase.from("feedback").select("subject, kind, status, by_id").eq("id", i.id).maybeSingle<{ subject: string; kind: string; status: string; by_id: string | null }>();
      const { data: to } = f?.by_id ? await s.supabase.from("profiles").select("email").eq("id", f.by_id).maybeSingle<{ email: string }>() : { data: null };
      if (f && to?.email && f.by_id !== s.profile.id) {
        const link = `${await currentOrigin()}/feedback#f-${i.id}`;
        const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">ANSWER TO YOUR ${h(kindLabel(f.kind).toUpperCase())} · ${h(statusOf(f.status).label.toUpperCase())}</div>
<div style="font-size:22px;font-weight:800;margin:4px 0 12px;">${h(f.subject)}</div>
<p style="font-size:15px;margin:0 0 12px;line-height:1.55;white-space:pre-wrap;">${h(i.reply.trim())}</p>
<p style="font-size:13px;margin:0;color:#52525b;">${h(s.profile.full_name ?? "Jeremiah")}</p>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">OPEN IN A.I.</a></p>`;
        await sendEmail({ to: [to.email], subject: `Answer: ${f.subject.slice(0, 90)}`, html: wrapEmail("Feedback answer", inner), text: `${f.subject}\n\n${i.reply}\n\n${link}` });
      }
    } catch {
      /* email is a courtesy */
    }
  }
  revalidatePath("/feedback");
  return { ok: true, msg: data === "answered" ? "Answered. They'll see it in the app and get an email." : "Saved." };
}

export async function markFeedbackSeen(): Promise<void> {
  const s = await getSession();
  if (!s?.profile) return;
  await s.supabase.rpc("feedback_seen");
}
