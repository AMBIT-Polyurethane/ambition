import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { LessonQuiz } from "@/components/academy/lesson-quiz";
import type { AcademyAttempt, AcademyLesson, AcademyQuestion, Course } from "@/lib/types";

export const metadata = { title: "Lesson" };

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireActive();
  const admin = profile.role === "admin";

  const { data: lesson } = await supabase.from("academy_lessons").select("*").eq("id", id).maybeSingle<AcademyLesson>();
  if (!lesson) notFound();
  const [{ data: course }, { data: qs }, { data: tries }, { data: siblings }] = await Promise.all([
    supabase.from("courses").select("*").eq("id", lesson.course_id).maybeSingle<Course>(),
    supabase.from("academy_questions").select("id, lesson_id, sort, prompt, choices").eq("lesson_id", id).order("sort").order("id"),
    supabase.from("academy_attempts").select("*").eq("lesson_id", id).eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("academy_lessons").select("id, number, status").eq("course_id", lesson.course_id).order("number"),
  ]);
  const questions = (qs ?? []) as AcademyQuestion[];
  const attempts = (tries ?? []) as AcademyAttempt[];
  const best = attempts.reduce<AcademyAttempt | null>((b, a) => (!b || a.score / a.total > b.score / b.total ? a : b), null);
  const next = ((siblings ?? []) as Pick<AcademyLesson, "id" | "number" | "status">[]).find((l) => l.number > lesson.number && (l.status === "live" || admin));
  const video = lesson.video_path ? (await supabase.storage.from("academy").createSignedUrl(lesson.video_path, 60 * 60 * 6)).data?.signedUrl ?? null : null;

  return (
    <main className="shell">
      <TopBar title={`Lesson ${lesson.number}`} back={`/academy/course/${lesson.course_id}`} />
      <div className="col tight">
        {course ? <div className="eyebrow">{course.title}</div> : null}
        <h2 style={{ margin: 0 }}>{lesson.title}</h2>
        <div className="row wrap small muted">
          <span>{[lesson.minutes ? `${lesson.minutes} min` : null, questions.length ? `${questions.length}-question quiz, pass with ${lesson.pass_pct}%` : null].filter(Boolean).join(" · ")}</span>
          {lesson.status === "draft" ? <span className="pill warn">Draft: only admins see this</span> : null}
        </div>
      </div>

      {video ? (
        <video className="lesson-video" src={video} controls playsInline preload="metadata" />
      ) : (
        <div className="card lesson-video empty-video">
          <span className="muted small">{admin ? "No video yet. Upload it in Admin > Academy." : "The video for this lesson is coming soon."}</span>
        </div>
      )}

      {lesson.summary ? <p className="muted" style={{ margin: 0 }}>{lesson.summary}</p> : null}

      {best ? (
        <div className="card row" style={{ gap: 10 }}>
          {best.passed ? <CircleCheck size={20} className="ok-ic" /> : null}
          <div className="grow small">
            {best.passed ? <b>You passed this lesson</b> : <b>Not passed yet</b>} · best score {best.score} of {best.total}
            {attempts.length > 1 ? ` · ${attempts.length} tries` : ""}
          </div>
        </div>
      ) : null}

      {questions.length ? (
        <section className="section">
          <div className="eyebrow">Quiz</div>
          <LessonQuiz lessonId={lesson.id} questions={questions} passPct={lesson.pass_pct} nextHref={next ? `/academy/lesson/${next.id}` : null} />
        </section>
      ) : null}

      {lesson.discussion ? (
        <section className="card col tight">
          <div className="eyebrow">For your crew</div>
          <p style={{ margin: 0 }}>{lesson.discussion}</p>
          <p className="tiny faint" style={{ margin: 0 }}>Talk it over with your classmates or at your next crew meeting.</p>
        </section>
      ) : null}

      {next ? (
        <Link href={`/academy/lesson/${next.id}`} className="btn dark block">Next: lesson {next.number}</Link>
      ) : null}
    </main>
  );
}
