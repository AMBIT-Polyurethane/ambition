import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, CircleCheck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { TopBar, Empty } from "@/components/ui";
import type { AcademyAttempt, AcademyLesson, Course } from "@/lib/types";

export const metadata = { title: "Course" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireActive();
  const admin = profile.role === "admin";

  const { data: course } = await supabase.from("courses").select("*").eq("id", id).maybeSingle<Course>();
  if (!course) notFound();
  const { data: ls } = await supabase.from("academy_lessons").select("*").eq("course_id", id).order("number");
  const lessons = (ls ?? []) as AcademyLesson[];
  const ids = lessons.map((l) => l.id);
  const { data: tries } = ids.length
    ? await supabase.from("academy_attempts").select("lesson_id, score, total, passed").eq("user_id", user.id).in("lesson_id", ids)
    : { data: [] };
  const best = new Map<string, Pick<AcademyAttempt, "score" | "total" | "passed">>();
  for (const a of (tries ?? []) as Pick<AcademyAttempt, "lesson_id" | "score" | "total" | "passed">[]) {
    const b = best.get(a.lesson_id);
    if (!b || a.score / a.total > b.score / b.total) best.set(a.lesson_id, a);
  }
  const passed = lessons.filter((l) => best.get(l.id)?.passed).length;

  return (
    <main className="shell">
      <TopBar title="AMBIT Academy" back="/academy" />
      <div className="col tight">
        <h2 style={{ margin: 0 }}>{course.title}</h2>
        {course.subtitle ? <p className="muted" style={{ margin: 0 }}>{course.subtitle}</p> : null}
        {lessons.length ? (
          <>
            <div className="small muted">{passed} of {lessons.length} lessons passed</div>
            <div className="progress"><span style={{ width: `${(passed / lessons.length) * 100}%` }} /></div>
          </>
        ) : null}
      </div>

      {lessons.length ? (
        <div className="list">
          {lessons.map((l) => {
            const b = best.get(l.id);
            return (
              <Link key={l.id} href={`/academy/lesson/${l.id}`} className="item">
                <div className="ic lesson-num">{l.number}</div>
                <div className="grow">
                  <div className="t">{l.title}</div>
                  <div className="s">
                    {[l.minutes ? `${l.minutes} min` : null, b ? `best ${b.score}/${b.total}` : "quiz not taken"].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {l.status === "draft" ? <span className="pill warn">Draft</span> : b?.passed ? <CircleCheck size={20} className="ok-ic" /> : <ChevronRight size={18} className="chev" />}
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty icon="academy" title="No lessons yet">{admin ? "Add lessons in Admin > Academy." : "Lessons for this course are coming soon."}</Empty>
      )}
    </main>
  );
}
