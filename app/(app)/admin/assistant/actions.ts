"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { canEmailCustomers, emailConfigured, sendEmail, wrapEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { KINDS, MODELS, chunkPages, cleanSite, type ChunkRow } from "@/lib/assistant/config";

const KIND_IDS = KINDS.map((k) => k.id) as string[];
const back = (tab: string, q: Record<string, string> = {}) => `/admin/assistant?${new URLSearchParams({ tab, ...q }).toString()}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function canTeach(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"]): Promise<boolean> {
  const { data } = await supabase.rpc("ai_can_teach");
  return Boolean(data);
}

// ------------------------------------------------------------------ settings
export async function saveAiSettings(formData: FormData) {
  const { supabase, profile } = await requireAdmin();
  const teach = await canTeach(supabase);
  const num = (k: string, d: number) => Math.min(Math.max(Math.round(Number(formData.get(k)) || d), 1), 2000);
  const sitesIn = String(formData.get("allowed_sites") ?? "").split(/[\s,]+/).filter(Boolean);
  const sites: string[] = [];
  const refused: string[] = [];
  for (const raw of sitesIn) {
    const c = cleanSite(raw);
    if (c && !sites.includes(c)) sites.push(c);
    else if (!c) refused.push(raw);
  }
  const model = String(formData.get("model") ?? "");
  const update: Record<string, unknown> = {
    open_to_customers: formData.get("open_to_customers") === "yes",
    model: MODELS.some((m) => m.id === model) ? model : MODELS[0].id,
    web_lookups: formData.get("web_lookups") === "on",
    allowed_sites: sites,
    daily_limit_staff: num("daily_limit_staff", 150),
    daily_limit_customer: num("daily_limit_customer", 40),
    updated_at: new Date().toISOString(),
    updated_by_name: profile.full_name || profile.email,
  };
  if (teach) {
    update.extra_rules = String(formData.get("extra_rules") ?? "").trim().slice(0, 6000) || null;
    update.teachers = formData.getAll("teachers").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  }
  const { error } = await supabase.from("ai_settings").update(update).eq("id", true);
  if (error) redirect(back("settings", { err: "Couldn't save the settings." }));
  revalidatePath("/", "layout");
  const note = refused.length
    ? `Saved. Not added (not a website, or a foam-industry site that's never allowed): ${refused.join(", ")}`
    : "Settings saved.";
  redirect(back("settings", { msg: note }));
}

// ------------------------------------------------------------------ knowledge
export type NewSource = {
  kind: string;
  origin: "upload" | "document";
  title: string;
  document_id?: string | null;
  storage_path?: string | null;
  file_name?: string | null;
  pages?: number | null;
  staff_only?: boolean;
};

/** A PDF added for the assistant, or a Docs-library document: returns its id (reuses a document's). */
export async function createSource(s: NewSource): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await requireAdmin();
  if (!KIND_IDS.includes(s.kind)) return { error: "Pick what kind of knowledge it is." };
  if (s.kind === "teaching" && !(await canTeach(supabase))) return { error: "Only AMBIT's building-science teacher can add teaching." };
  const row = {
    kind: s.kind,
    origin: s.origin,
    title: s.title.trim().slice(0, 300) || "Untitled",
    document_id: s.document_id ?? null,
    storage_path: s.storage_path ?? null,
    file_name: s.file_name ?? null,
    pages: s.pages ?? null,
    staff_only: Boolean(s.staff_only),
    status: "empty",
    created_by: profile.id,
    created_by_name: profile.full_name || profile.email,
    updated_at: new Date().toISOString(),
  };
  if (s.document_id) {
    const { data: had } = await supabase.from("ai_sources").select("id").eq("document_id", s.document_id).maybeSingle();
    if (had) {
      const { error } = await supabase.from("ai_sources").update({ title: row.title, pages: row.pages, updated_at: row.updated_at }).eq("id", had.id);
      return error ? { error: "Couldn't update it." } : { id: had.id as string };
    }
  }
  const { data, error } = await supabase.from("ai_sources").insert(row).select("id").single();
  if (error || !data) return { error: "Couldn't save it." };
  return { id: data.id as string };
}

/** Saves the words of a source in pieces (first batch replaces, later batches add). */
export async function saveChunks(sourceId: string, chunks: ChunkRow[], append: boolean): Promise<{ ok?: boolean; error?: string; count?: number }> {
  const { supabase } = await requireAdmin();
  const clean = chunks.slice(0, 400).map((c, i) => ({
    page: c.page ?? null,
    seq: Number.isFinite(c.seq) ? c.seq : i,
    title: String(c.title ?? "").slice(0, 300),
    body: String(c.body ?? "").slice(0, 4000),
  }));
  const { data, error } = await supabase.rpc("ai_replace_chunks", { p_source: sourceId, p_chunks: clean, p_append: append });
  if (error) return { error: error.message.includes("Not allowed") ? "Only AMBIT's building-science teacher can change teaching." : "Couldn't save the text." };
  return { ok: true, count: Number(data ?? 0) };
}

export async function sourceFailed(sourceId: string, message: string) {
  const { supabase } = await requireAdmin();
  await supabase.from("ai_sources").update({ status: "error", error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", sourceId);
  return { ok: true };
}

export async function refreshAssistantAdmin() {
  revalidatePath("/admin/assistant");
  return { ok: true };
}

/** Teaching (or app help) written in the app. Edits replace the old words. */
export async function saveNote(formData: FormData) {
  const { supabase, profile } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 300);
  const body = String(formData.get("body") ?? "").trim().slice(0, 60000);
  const kind = String(formData.get("kind") ?? "teaching");
  const tab = String(formData.get("tab") ?? "teach");
  if (!title || !body) redirect(back(tab, { err: "Give it a title and write the teaching." }));
  if (!KIND_IDS.includes(kind)) redirect(back(tab, { err: "Pick what kind of knowledge it is." }));
  if (kind === "teaching" && !(await canTeach(supabase))) redirect(back(tab, { err: "Only AMBIT's building-science teacher can add teaching." }));

  const row = {
    kind,
    title,
    body,
    staff_only: formData.get("staff_only") === "on",
    updated_at: new Date().toISOString(),
  };
  let sourceId = /^[0-9a-f-]{36}$/i.test(id) ? id : "";
  if (sourceId) {
    const { error } = await supabase.from("ai_sources").update(row).eq("id", sourceId);
    if (error) redirect(back(tab, { err: "Couldn't save it (only the teacher can change teaching)." }));
  } else {
    const { data, error } = await supabase
      .from("ai_sources")
      .insert({ ...row, origin: "note", created_by: profile.id, created_by_name: profile.full_name || profile.email })
      .select("id")
      .single();
    if (error || !data) redirect(back(tab, { err: "Couldn't save it." }));
    sourceId = data.id as string;
  }
  const chunks = chunkPages(title, [{ page: null, text: body }]);
  const { error } = await supabase.rpc("ai_replace_chunks", { p_source: sourceId, p_chunks: chunks, p_append: false });
  if (error) redirect(back(tab, { err: "Saved, but the assistant couldn't read it. Try saving again." }));
  revalidatePath("/admin/assistant");
  redirect(back(tab, { msg: `"${title}" saved. Ask AMBIT uses it from now on.` }));
}

export async function updateSource(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(back("teach"));
  const update: Record<string, unknown> = {
    enabled: formData.get("enabled") === "on",
    staff_only: formData.get("staff_only") === "on",
    updated_at: new Date().toISOString(),
  };
  if (KIND_IDS.includes(kind)) update.kind = kind;
  const { error } = await supabase.from("ai_sources").update(update).eq("id", id);
  revalidatePath("/admin/assistant");
  redirect(back("teach", error ? { err: "Couldn't change it (only the teacher can change teaching)." } : { msg: "Saved." }));
}

export async function deleteSource(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (formData.get("confirm") !== "yes") redirect(back("teach", { err: "Tick the box to confirm removing it." }));
  const { data: s } = await supabase.from("ai_sources").select("storage_path, title").eq("id", id).maybeSingle();
  const { error } = await supabase.from("ai_sources").delete().eq("id", id);
  if (!error && s?.storage_path) await supabase.storage.from("knowledge").remove([s.storage_path]);
  revalidatePath("/admin/assistant");
  redirect(back("teach", error ? { err: "Couldn't remove it (only the teacher can remove teaching)." } : { msg: `Removed "${s?.title ?? "it"}". Ask AMBIT no longer uses it.` }));
}

// ------------------------------------------------------------------ expert inbox
export async function answerQuestion(formData: FormData) {
  const { supabase, profile } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const answer = String(formData.get("answer") ?? "").trim().slice(0, 20000);
  const saveAs = String(formData.get("save_as") ?? "none");
  if (!answer) redirect(back("questions", { err: "Write the answer first." }));
  const { data: q } = await supabase.from("ai_questions").select("*").eq("id", id).maybeSingle();
  if (!q) redirect(back("questions", { err: "That question wasn't found." }));
  const me = profile.full_name || profile.email;

  // Teach the assistant with it, if asked.
  let sourceId: string | null = null;
  let note = "";
  if (KIND_IDS.includes(saveAs)) {
    if (saveAs === "teaching" && !(await canTeach(supabase))) {
      note = " (not saved as teaching: only AMBIT's building-science teacher can add teaching)";
    } else {
      const question = String(q.question).split("\n\nMore from")[0].trim();
      const title = question.length > 120 ? `${question.slice(0, 117)}…` : question;
      const body = `Question: ${question}\n\nAnswer from ${me}:\n${answer}`;
      const { data: src } = await supabase
        .from("ai_sources")
        .insert({ kind: saveAs, origin: "answer", title, body, created_by: profile.id, created_by_name: me, staff_only: false })
        .select("id")
        .single();
      if (src) {
        sourceId = src.id as string;
        await supabase.rpc("ai_replace_chunks", { p_source: sourceId, p_chunks: chunkPages(title, [{ page: null, text: body }]), p_append: false });
      }
    }
  }

  const { error } = await supabase
    .from("ai_questions")
    .update({ status: "answered", answer, answered_by: profile.id, answered_by_name: me, answered_at: new Date().toISOString(), source_id: sourceId })
    .eq("id", id);
  if (error) redirect(back("questions", { err: "Couldn't save the answer." }));

  // Put the answer in their conversation and let them know.
  if (q.thread_id && q.user_id) {
    await supabase.from("ai_messages").insert({ thread_id: q.thread_id, user_id: q.user_id, role: "expert", body: answer, author_name: me });
    await supabase.from("ai_threads").update({ unread: true, updated_at: new Date().toISOString() }).eq("id", q.thread_id);
  }
  if (q.user_id) {
    const { data: who } = await supabase.from("profiles").select("email, full_name, role").eq("id", q.user_id).maybeSingle();
    const canSend = who?.email && (who.role === "customer" ? canEmailCustomers() : emailConfigured());
    if (canSend) {
      const origin = await currentOrigin();
      const link = `${origin}/assistant${q.thread_id ? `?t=${q.thread_id}` : ""}`;
      await sendEmail({
        to: [who!.email],
        subject: "AMBIT answered your question",
        text: `Your question: ${q.question}\n\nAnswer from ${me}:\n${answer}\n\nSee it in AMBIT A.I.: ${link}`,
        html: wrapEmail(
          "Ask AMBIT",
          `<p style="margin:0 0 10px;font-size:15px;">Hi ${esc(who!.full_name?.split(" ")[0] || "there")}, AMBIT answered the question you sent:</p>
<blockquote style="margin:0 0 14px;padding:10px 14px;background:#f4f4f5;border-left:4px solid #a1a1aa;font-size:14px;white-space:pre-wrap;">${esc(String(q.question))}</blockquote>
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;color:#71717a;">ANSWER FROM ${esc(me.toUpperCase())}</p>
<div style="margin:0 0 18px;font-size:15px;line-height:1.5;white-space:pre-wrap;">${esc(answer)}</div>
<p style="margin:0;"><a href="${link}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:800;letter-spacing:1px;padding:12px 18px;border-radius:8px;">OPEN IN AMBIT A.I.</a></p>`,
        ),
      });
    }
  }
  revalidatePath("/admin/assistant");
  redirect(back("questions", { msg: `Answer sent${sourceId ? " and Ask AMBIT learned it" : ""}${note}.` }));
}

export async function dismissQuestion(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("ai_questions").update({ status: "dismissed" }).eq("id", String(formData.get("id") ?? ""));
  revalidatePath("/admin/assistant");
  redirect(back("questions", { msg: "Question closed without an answer." }));
}
