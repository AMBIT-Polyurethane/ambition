"use server";

import { revalidatePath } from "next/cache";
import { requireActive } from "@/lib/session";
import type { QuizResult } from "@/lib/types";

/** Grades a lesson's quiz on the server (the answers never reach the browser before this) and saves the attempt. */
export async function submitQuiz(lessonId: string, answers: Record<string, number>): Promise<{ result: QuizResult } | { error: string }> {
  const { supabase } = await requireActive();
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(answers ?? {})) if (/^[0-9a-f-]{36}$/i.test(k) && Number.isInteger(v) && v >= 0 && v < 6) clean[k] = v;
  const { data, error } = await supabase.rpc("academy_submit", { p_lesson: lessonId, p_answers: clean });
  if (error) return { error: error.message || "Couldn't grade the quiz. Try again." };
  revalidatePath(`/academy/lesson/${lessonId}`);
  revalidatePath("/academy");
  return { result: data as QuizResult };
}

/** Remembers the language someone wants their Academy lessons in. */
export async function setAcademyLang(lang: "en" | "es"): Promise<{ error?: string }> {
  const { supabase } = await requireActive();
  const { error } = await supabase.rpc("academy_set_lang", { p_lang: lang === "es" ? "es" : "en" });
  if (error) return { error: error.message };
  revalidatePath("/academy", "layout");
  return {};
}
