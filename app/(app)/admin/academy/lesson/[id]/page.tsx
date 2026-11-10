import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { ConfirmSubmit, Submit } from "@/components/forms";
import { LessonForm, QuestionForm, VideoUpload, type QuestionDraft } from "@/components/academy/admin";
import { createTranslation, deleteLesson, deleteQuestion } from "@/app/(app)/admin/academy/actions";
import type { AcademyLesson, AcademyQuestion, Course } from "@/lib/types";

export const metadata = { title: "Edit lesson" };

type Try = {
  user_id: string; score: number; total: number; passed: boolean; created_at: string;
  profile: { full_name: string | null; email: string; company: { name: string } | null } | null;
};

const when = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function LessonAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const { data: lesson } = await supabase.from("academy_lessons").select("*").eq("id", id).maybeSingle<AcademyLesson>();
  if (!lesson) notFound();
  const [{ data: course }, { data: qs }, { data: key }, { data: tries }, { data: sibs }] = await Promise.all([
    supabase.from("courses").select("*").eq("id", lesson.course_id).maybeSingle<Course>(),
    supabase.from("academy_questions").select("id, lesson_id, sort, prompt, choices").eq("lesson_id", id).order("sort").order("id"),
    supabase.rpc("academy_answer_key", { p_lesson: id }),
    supabase
      .from("academy_attempts")
      .select("user_id, score, total, passed, created_at, profile:profiles!user_id(full_name, email, company:companies!company_id(name))")
      .eq("lesson_id", id)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("academy_lessons").select("*").eq("course_id", lesson.course_id),
  ]);
  // Spanish versions (0056): the English lesson links to its Spanish one and back.
  const course_lessons = (sibs ?? []) as AcademyLesson[];
  const canTranslate = "lang" in lesson;
  const english = lesson.translation_of ? course_lessons.find((l) => l.id === lesson.translation_of) ?? null : null;
  const spanish = !lesson.translation_of ? course_lessons.find((l) => l.translation_of === lesson.id && l.lang === "es") ?? null : null;
  const keys = new Map(((key ?? []) as { id: string; answer: number; explain: string | null }[]).map((k) => [k.id, k]));
  const questions: QuestionDraft[] = ((qs ?? []) as AcademyQuestion[]).map((q) => ({
    id: q.id, sort: q.sort, prompt: q.prompt, choices: q.choices, answer: keys.get(q.id)?.answer ?? 0, explain: keys.get(q.id)?.explain ?? null,
  }));
  const video = lesson.video_path ? (await supabase.storage.from("academy").createSignedUrl(lesson.video_path, 60 * 60)).data?.signedUrl ?? null : null;
  // Light-mode copy (0058): only once the column exists.
  const canLight = "video_path_light" in lesson;
  const videoLight = lesson.video_path_light ? (await supabase.storage.from("academy").createSignedUrl(lesson.video_path_light, 60 * 60)).data?.signedUrl ?? null : null;

  // One row per person: best score, how many tries, last try.
  const people = new Map<string, { name: string; company: string; best: Try; tries: number; last: string }>();
  for (const t of (tries ?? []) as unknown as Try[]) {
    const p = people.get(t.user_id);
    if (!p) people.set(t.user_id, { name: t.profile?.full_name || t.profile?.email || "Someone", company: t.profile?.company?.name ?? "AMBIT", best: t, tries: 1, last: t.created_at });
    else {
      p.tries += 1;
      if (t.score / t.total > p.best.score / p.best.total) p.best = t;
    }
  }
  const rows = [...people.values()].sort((a, b) => b.last.localeCompare(a.last));
  const passed = rows.filter((r) => r.best.passed).length;

  return (
    <main className="shell wide">
      <TopBar title={`Lesson ${lesson.number}: ${lesson.title}`} back="/admin/academy"
        right={<Link className="btn sm dark" href={`/academy/lesson/${lesson.id}`}>Preview</Link>} />
      {course ? <div className="eyebrow">{course.title}</div> : null}

      {english ? (
        <div className="card small">
          Spanish version of <Link href={`/admin/academy/lesson/${english.id}`}><b>Lesson {english.number}: {english.title}</b></Link>. Students see an English / Español switch on the lesson once both are live.
        </div>
      ) : null}

      <LessonForm lesson={lesson} />

      {canTranslate && !lesson.translation_of ? (
        <section className="section">
          <div className="eyebrow">Spanish version</div>
          {spanish ? (
            <Link href={`/admin/academy/lesson/${spanish.id}`} className="item card">
              <div className="ic lesson-num" style={{ fontSize: 12 }}>ES</div>
              <div className="grow">
                <div className="t">{spanish.title}</div>
                <div className="s">{spanish.video_path ? "Video uploaded" : "No video yet"} · its own quiz and results</div>
              </div>
              {spanish.status === "live" ? <span className="pill ok">Live</span> : <span className="pill warn">Draft</span>}
            </Link>
          ) : (
            <form action={createTranslation} className="card row wrap" style={{ alignItems: "center" }}>
              <input type="hidden" name="id" value={lesson.id} />
              <div className="grow small muted">Add a Spanish version with its own video and quiz. Students get an English / Español switch on this lesson.</div>
              <Submit className="btn sm">Add a Spanish version</Submit>
            </form>
          )}
        </section>
      ) : null}

      <section className="section">
        <div className="eyebrow">{canLight ? "Video · dark (the main one)" : "Video"}</div>
        <div className="card col">
          {video ? <video className="lesson-video" src={video} controls playsInline preload="metadata" /> : <div className="small muted">No video yet.</div>}
          <VideoUpload lessonId={lesson.id} hasVideo={Boolean(video)} />
        </div>
      </section>

      {canLight ? (
        <section className="section">
          <div className="eyebrow">Light-mode video (optional)</div>
          <div className="card col">
            <div className="small muted">
              The same lesson with a white background. People who use the app in Light mode (Profile → Appearance → Light, or Auto on a phone or computer set to light) see this one; everyone else sees the main video. Without it, everyone sees the main video.
            </div>
            {videoLight ? <video className="lesson-video light-look" src={videoLight} controls playsInline preload="metadata" /> : <div className="small muted">No light-mode video yet.</div>}
            <VideoUpload lessonId={lesson.id} hasVideo={Boolean(videoLight)} look="light" />
          </div>
        </section>
      ) : (
        <div className="alert small">Light-mode videos need update 0058 run in Supabase first.</div>
      )}

      <section className="section">
        <div className="eyebrow">Quiz · {questions.length} question{questions.length === 1 ? "" : "s"} · pass with {lesson.pass_pct}%</div>
        <div className="list">
          {questions.map((q, i) => (
            <details key={q.id}>
              <summary className="item" style={{ minHeight: 56 }}>
                <div className="ic lesson-num">{i + 1}</div>
                <div className="grow">
                  <div className="t">{q.prompt}</div>
                  <div className="s">Answer: {q.choices[q.answer]}</div>
                </div>
                <span className="small red">Edit</span>
              </summary>
              <QuestionForm lessonId={lesson.id} q={q} n={i + 1} />
              <form action={deleteQuestion} style={{ padding: "0 16px 16px" }}>
                <input type="hidden" name="id" value={q.id} />
                <input type="hidden" name="lesson_id" value={lesson.id} />
                <ConfirmSubmit className="btn sm ghost" confirm="Delete this question?">Delete question</ConfirmSubmit>
              </form>
            </details>
          ))}
          <details>
            <summary className="item" style={{ minHeight: 56 }}><b>+ Add a question</b></summary>
            <QuestionForm lessonId={lesson.id} n={questions.length + 1} />
          </details>
        </div>
      </section>

      <section className="section">
        <div className="eyebrow">Results · {rows.length} {rows.length === 1 ? "person" : "people"} · {passed} passed</div>
        {rows.length ? (
          <div className="card flush" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Person</th><th>Company</th><th>Best score</th><th>Tries</th><th>Last try</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name + r.last}>
                    <td>{r.name}</td>
                    <td>{r.company}</td>
                    <td>{r.best.score}/{r.best.total} {r.best.passed ? <span className="pill ok">Passed</span> : <span className="pill grey">Not yet</span>}</td>
                    <td>{r.tries}</td>
                    <td>{when(r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="small muted">Nobody has taken this quiz yet.</div>}
      </section>

      <form action={deleteLesson}>
        <input type="hidden" name="id" value={lesson.id} />
        <ConfirmSubmit className="btn sm danger" confirm="Delete this lesson, its quiz, its video and everyone's results? This can't be undone.">Delete lesson</ConfirmSubmit>
      </form>
    </main>
  );
}
