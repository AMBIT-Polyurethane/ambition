import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, CircleCheck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { TopBar, Empty } from "@/components/ui";
import { LangSwitch } from "@/components/academy/lang-switch";
import { academyText, asLang } from "@/lib/academy-i18n";
import type { AcademyAttempt, AcademyLesson, Course } from "@/lib/types";

export const metadata = { title: "Course" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireActive();
  const admin = profile.role === "admin";

  const { data: course } = await supabase.from("courses").select("*").eq("id", id).maybeSingle<Course>();
  if (!course) notFound();
  const { data: ls } = await supabase.from("academy_lessons").select("*").eq("course_id", id).order("number");
  const all = (ls ?? []) as AcademyLesson[];
  // English lessons are the list; a Spanish version (0056) stands in for its lesson when the person picked Spanish.
  const base = all.filter((l) => !l.translation_of);
  const spanish = new Map(all.filter((l) => l.translation_of && l.lang === "es").map((l) => [l.translation_of as string, l]));
  const want = asLang(profile.academy_lang);
  const lang = want === "es" && spanish.size ? "es" : "en";
  const t = academyText(lang);
  const shown = base.map((b) => (lang === "es" ? spanish.get(b.id) ?? b : b));

  const ids = all.map((l) => l.id);
  const { data: tries } = ids.length
    ? await supabase.from("academy_attempts").select("lesson_id, score, total, passed").eq("user_id", user.id).in("lesson_id", ids)
    : { data: [] };
  // Best try per lesson, counting both languages.
  const baseOf = new Map(all.map((l) => [l.id, l.translation_of ?? l.id]));
  const best = new Map<string, Pick<AcademyAttempt, "score" | "total" | "passed">>();
  for (const a of (tries ?? []) as Pick<AcademyAttempt, "lesson_id" | "score" | "total" | "passed">[]) {
    const k = baseOf.get(a.lesson_id) ?? a.lesson_id;
    const b = best.get(k);
    if (!b || (a.passed && !b.passed) || (a.passed === b.passed && a.score / a.total > b.score / b.total)) best.set(k, a);
  }
  const passed = base.filter((l) => best.get(l.id)?.passed).length;

  return (
    <main className="shell">
      <TopBar title="AMBIT Academy" back="/academy" />
      <div className="col tight">
        <h2 style={{ margin: 0 }}>{course.title}</h2>
        {course.subtitle ? <p className="muted" style={{ margin: 0 }}>{course.subtitle}</p> : null}
        {base.length ? (
          <>
            <div className="small muted">{t.lessonsPassed(passed, base.length)}</div>
            <div className="progress"><span style={{ width: `${(passed / base.length) * 100}%` }} /></div>
          </>
        ) : null}
        {spanish.size ? <LangSwitch lang={lang} enHref={`/academy/course/${id}`} esHref={`/academy/course/${id}`} /> : null}
      </div>

      {shown.length ? (
        <div className="list">
          {shown.map((l) => {
            const b = best.get(l.translation_of ?? l.id);
            const es = !l.translation_of && spanish.has(l.id);
            return (
              <Link key={l.id} href={`/academy/lesson/${l.id}`} className="item">
                <div className="ic lesson-num">{l.number}</div>
                <div className="grow">
                  <div className="t">{l.title}</div>
                  <div className="s">
                    {[l.minutes ? t.min(l.minutes) : null, b ? t.best(b.score, b.total) : t.notTaken, es && lang === "en" ? "también en español" : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {l.status === "draft" ? <span className="pill warn">Draft</span> : b?.passed ? <CircleCheck size={20} className="ok-ic" /> : <ChevronRight size={18} className="chev" />}
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty icon="academy" title="No lessons yet">{admin ? "Add lessons in Admin > Academy." : t.noLessons}</Empty>
      )}
    </main>
  );
}
