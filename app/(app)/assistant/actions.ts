"use server";

import { revalidatePath } from "next/cache";
import { requireActive } from "@/lib/session";
import { ADMIN_NOTIFY_EMAIL } from "@/lib/env";
import { sendEmail, wrapEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Thumbs up (1), thumbs down (-1) or clear (0), with an optional note. */
export async function rateAnswer(id: number, rating: number, feedback?: string) {
  const { supabase, profile } = await requireActive();
  const r = rating > 0 ? 1 : rating < 0 ? -1 : null;
  const { error } = await supabase
    .from("ai_messages")
    .update({ rating: r, feedback: feedback?.trim().slice(0, 1000) || null })
    .eq("id", id)
    .eq("user_id", profile.id)
    .eq("role", "assistant");
  return error ? { error: "Couldn't save that." } : { ok: true };
}

/** Sends a question the assistant couldn't answer (or got wrong) to AMBIT's expert. */
export async function sendToExpert(messageId: number, note?: string) {
  const { supabase, profile } = await requireActive();
  const { data: answer } = await supabase
    .from("ai_messages")
    .select("id, thread_id, body")
    .eq("id", messageId)
    .eq("user_id", profile.id)
    .eq("role", "assistant")
    .maybeSingle();
  if (!answer) return { error: "That answer wasn't found." };

  const { data: already } = await supabase.from("ai_questions").select("id").eq("message_id", messageId).maybeSingle();
  if (already) return { ok: true, already: true };

  const { data: q } = await supabase
    .from("ai_messages")
    .select("body")
    .eq("thread_id", answer.thread_id)
    .eq("role", "user")
    .lt("id", messageId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const question = [q?.body ?? "(question not found)", note?.trim() ? `\n\nMore from ${profile.full_name || "them"}: ${note.trim()}` : ""].join("").slice(0, 6000);

  const { error } = await supabase.from("ai_questions").insert({
    thread_id: answer.thread_id,
    message_id: messageId,
    user_id: profile.id,
    user_name: profile.full_name || profile.email,
    user_company: profile.role === "customer" ? profile.company?.name ?? null : "AMBIT",
    question,
    draft: String(answer.body ?? "").replace(/⟦[\d,\s]+⟧/g, "").slice(0, 6000),
  });
  if (error) return { error: "Couldn't send it. Try again." };

  if (ADMIN_NOTIFY_EMAIL) {
    const origin = await currentOrigin();
    const link = `${origin}/admin/assistant?tab=questions`;
    await sendEmail({
      to: [ADMIN_NOTIFY_EMAIL],
      subject: `Ask AMBIT question from ${profile.full_name || profile.email}`,
      text: `${profile.full_name || profile.email} asked:\n\n${question}\n\nAnswer it in the app: ${link}`,
      html: wrapEmail(
        "Ask AMBIT",
        `<p style="margin:0 0 12px;font-size:15px;"><b>${esc(profile.full_name || profile.email)}</b>${profile.role === "customer" && profile.company?.name ? ` (${esc(profile.company.name)})` : ""} sent a question to AMBIT's expert:</p>
<blockquote style="margin:0 0 16px;padding:12px 14px;background:#f4f4f5;border-left:4px solid #E33527;font-size:15px;white-space:pre-wrap;">${esc(question)}</blockquote>
<p style="margin:0;"><a href="${link}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:800;letter-spacing:1px;padding:12px 18px;border-radius:8px;">ANSWER IN AMBIT A.I.</a></p>`,
      ),
    });
  }
  revalidatePath("/assistant");
  return { ok: true };
}

export async function deleteThread(id: string) {
  const { supabase, profile } = await requireActive();
  await supabase.from("ai_threads").delete().eq("id", id).eq("user_id", profile.id);
  revalidatePath("/assistant");
  return { ok: true };
}

export async function markThreadRead(id: string) {
  const { supabase, profile } = await requireActive();
  await supabase.from("ai_threads").update({ unread: false }).eq("id", id).eq("user_id", profile.id).eq("unread", true);
  return { ok: true };
}
