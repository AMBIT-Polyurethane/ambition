import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { LessonQuiz } from "@/components/academy/lesson-quiz";
import { LangSwitch } from "@/components/academy/lang-switch";
import { LessonVideo } from "@/components/academy/lesson-video";
import { getTheme } from "@/lib/theme-server";
import { academyText, asLang } from "@/lib/academy-i18n";
import type { AcademyAttempt, AcademyLesson, AcademyQuestion, Course } from "@/lib/types";

export const metadata = { title: "Lesson" };

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireActive();
  const admin = profile.role === "admin";

  const { data: lesson } = await supabase.from("academy_lessons").select("*").eq("id", id).maybeSingle<AcademyLesson>();
  if (!lesson) notFound();

  // Every lesson in the course; the English ones are the list, a Spanish version points at its English lesson (0056).
  const { data: sibs } = await supabase.from("academy_lessons").select("*").eq("course_id", lesson.course_id).order("number");
  const all = (sibs ?? []) as AcademyLesson[];
  const baseId = lesson.translation_of ?? lesson.id;
  const enVersion = all.find((l) => l.id === baseId) ?? null;
  const esVersion = all.find((l) => l.translation_of === baseId && l.lang === "es") ?? null;
  const want = asLang(profile.academy_lang);
  if (want === "es" && lesson.lang !== "es" && esVersion) redirect(`/academy/lesson/${esVersion.id}`);
  const lang = lesson.lang === "es" ? "es" : "en";
  const t = academyText(lang);
  const versionIds = [enVersion?.id, esVersion?.id, lesson.id].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);

  const [{ data: course }, { data: qs }, { data: tries }] = await Promise.all([
    supabase.from("courses").select("*").eq("id", lesson.course_id).maybeSingle<Course>(),
    supabase.from("academy_questions").select("id, lesson_id, sort, prompt, choices").eq("lesson_id", id).order("sort").order("id"),
    supabase.from("academy_attempts").select("*").in("lesson_id", versionIds).eq("user_id", user.id).order("created_at", { ascending: false }).limit(40),
  ]);
  const questions = (qs ?? []) as AcademyQuestion[];
  const attempts = (tries ?? []) as AcademyAttempt[];
  // Best try in either language; a pass beats a higher score that didn't pass.
  const best = attempts.reduce<AcademyAttempt | null>((b, a) => (!b || (a.passed && !b.passed) || (a.passed === b.passed && a.score / a.total > b.score / b.total) ? a : b), null);
  const nextBase = all.find((l) => !l.translation_of && l.number > lesson.number && (l.status === "live" || admin));
  const nextEs = nextBase && lang === "es" ? all.find((l) => l.translation_of === nextBase.id && l.lang === "es") : null;
  const next = nextEs ?? nextBase ?? null;
  const sign = async (path: string | null | undefined) => (path ? (await supabase.storage.from("academy").createSignedUrl(path, 60 * 60 * 6)).data?.signedUrl ?? null : null);
  // The main video, and its light-mode copy when there is one (0058); the player shows the one that matches the app's look.
  const [video, videoLight, theme] = await Promise.all([sign(lesson.video_path), sign(lesson.video_path_light), getTheme()]);

  return (
    <main className="shell">
      <TopBar title={t.lesson(lesson.number)} back={`/academy/course/${lesson.course_id}`} />
      <div className="col tight">
        {course ? <div className="eyebrow">{course.title}</div> : null}
        <h2 style={{ margin: 0 }}>{lesson.title}</h2>
        <div className="row wrap small muted">
          <span>{[lesson.minutes ? t.min(lesson.minutes) : null, questions.length ? t.quizMeta(questions.length, lesson.pass_pct) : null].filter(Boolean).join(" · ")}</span>
          {lesson.status === "draft" ? <span className="pill warn">{t.draft}</span> : null}
        </div>
        {enVersion && esVersion ? <LangSwitch lang={lang} enHref={`/academy/lesson/${enVersion.id}`} esHref={`/academy/lesson/${esVersion.id}`} /> : null}
      </div>

      {video ? (
        <LessonVideo dark={video} light={videoLight} theme={theme} />
      ) : (
        <div className="card lesson-video empty-video">
          <span className="muted small">{admin ? t.noVideoAdmin : t.noVideo}</span>
        </div>
      )}

      {lesson.summary ? <p className="muted" style={{ margin: 0 }}>{lesson.summary}</p> : null}

      {best ? (
        <div className="card row" style={{ gap: 10 }}>
          {best.passed ? <CircleCheck size={20} className="ok-ic" /> : null}
          <div className="grow small">
            {best.passed ? <b>{t.passedLesson}</b> : <b>{t.notPassed}</b>} · {t.bestScore(best.score, best.total)}
            {attempts.length > 1 ? ` · ${t.tries(attempts.length)}` : ""}
          </div>
        </div>
      ) : null}

      {questions.length ? (
        <section className="section">
          <div className="eyebrow">{t.quiz}</div>
          <LessonQuiz lessonId={lesson.id} questions={questions} passPct={lesson.pass_pct} lang={lang} nextHref={next ? `/academy/lesson/${next.id}` : null} />
        </section>
      ) : null}

      {lesson.discussion ? (
        <section className="card col tight">
          <div className="eyebrow">{t.crew}</div>
          <p style={{ margin: 0 }}>{lesson.discussion}</p>
          <p className="tiny faint" style={{ margin: 0 }}>{t.crewNote}</p>
        </section>
      ) : null}

      {next ? (
        <Link href={`/academy/lesson/${next.id}`} className="btn dark block">{t.nextLesson(next.number)}</Link>
      ) : null}
    </main>
  );
}
