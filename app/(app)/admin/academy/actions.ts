"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => s(f, k) || null;
const int = (f: FormData, k: string) => {
  const v = parseInt(s(f, k), 10);
  return Number.isFinite(v) ? v : null;
};
const touch = (lessonId: string, courseId?: string | null) => {
  revalidatePath(`/admin/academy/lesson/${lessonId}`);
  revalidatePath(`/academy/lesson/${lessonId}`);
  revalidatePath("/admin/academy");
  revalidatePath("/academy");
  if (courseId) revalidatePath(`/academy/course/${courseId}`);
};

export async function createLesson(form: FormData) {
  const { supabase } = await requireAdmin();
  const course = s(form, "course_id");
  const title = s(form, "title");
  if (!course || !title) return;
  const { data: last } = await supabase.from("academy_lessons").select("number").eq("course_id", course).order("number", { ascending: false }).limit(1).maybeSingle<{ number: number }>();
  const { data, error } = await supabase
    .from("academy_lessons")
    .insert({ course_id: course, title, number: int(form, "number") ?? (last?.number ?? 0) + 1 })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(error?.message ?? "Couldn't add the lesson.");
  touch(data.id, course);
  redirect(`/admin/academy/lesson/${data.id}`);
}

export async function saveLesson(_: unknown, form: FormData): Promise<{ ok?: string; error?: string }> {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const title = s(form, "title");
  if (!title) return { error: "Give the lesson a title." };
  const status = s(form, "status") === "live" ? "live" : "draft";
  if (status === "live") {
    const { count } = await supabase.from("academy_questions").select("id", { count: "exact", head: true }).eq("lesson_id", id);
    if (!count) return { error: "Add at least one quiz question before making the lesson live." };
  }
  const pass = Math.min(100, Math.max(1, int(form, "pass_pct") ?? 80));
  const { data, error } = await supabase
    .from("academy_lessons")
    .update({
      title, status, pass_pct: pass,
      number: int(form, "number") ?? 1,
      minutes: int(form, "minutes"),
      summary: n(form, "summary"),
      discussion: n(form, "discussion"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("course_id")
    .maybeSingle<{ course_id: string }>();
  if (error) return { error: error.message };
  touch(id, data?.course_id);
  return { ok: status === "live" ? "Saved. The lesson is live for everyone who can see this course." : "Saved as a draft. Only admins can see it." };
}

export async function deleteLesson(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const { data: l } = await supabase.from("academy_lessons").select("video_path, course_id").eq("id", id).maybeSingle<{ video_path: string | null; course_id: string }>();
  await supabase.from("academy_lessons").delete().eq("id", id);
  if (l?.video_path) await supabase.storage.from("academy").remove([l.video_path]);
  touch(id, l?.course_id);
  redirect("/admin/academy");
}

/** After the browser uploads a video straight to storage, point the lesson at it (and remove the old one). */
export async function setLessonVideo(lessonId: string, path: string | null): Promise<{ error?: string }> {
  const { supabase } = await requireAdmin();
  if (path && !path.startsWith(`${lessonId}/`)) return { error: "That file isn't this lesson's." };
  const { data: l } = await supabase.from("academy_lessons").select("video_path, course_id").eq("id", lessonId).maybeSingle<{ video_path: string | null; course_id: string }>();
  const { error } = await supabase.from("academy_lessons").update({ video_path: path, updated_at: new Date().toISOString() }).eq("id", lessonId);
  if (error) return { error: error.message };
  if (l?.video_path && l.video_path !== path) await supabase.storage.from("academy").remove([l.video_path]);
  touch(lessonId, l?.course_id);
  return {};
}

export async function saveQuestion(_: unknown, form: FormData): Promise<{ ok?: string; error?: string }> {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const lesson = s(form, "lesson_id");
  const prompt = s(form, "prompt");
  const raw = [0, 1, 2, 3, 4, 5].map((i) => s(form, `choice_${i}`));
  const picked = int(form, "answer");
  if (!prompt) return { error: "Type the question." };
  if (picked == null || !raw[picked]) return { error: "Pick the right answer (it can't be an empty choice)." };
  const choices: string[] = [];
  let answer = 0;
  raw.forEach((c, i) => {
    if (!c) return;
    if (i === picked) answer = choices.length;
    choices.push(c);
  });
  if (choices.length < 2) return { error: "A question needs at least two choices." };
  const row = { lesson_id: lesson, prompt, choices, answer, explain: n(form, "explain"), sort: int(form, "sort") ?? 0 };
  const { error } = id
    ? await supabase.from("academy_questions").update(row).eq("id", id)
    : await supabase.from("academy_questions").insert(row);
  if (error) return { error: error.message };
  touch(lesson);
  return { ok: id ? "Question saved." : "Question added." };
}

export async function deleteQuestion(form: FormData) {
  const { supabase } = await requireAdmin();
  const lesson = s(form, "lesson_id");
  await supabase.from("academy_questions").delete().eq("id", s(form, "id"));
  touch(lesson);
}
