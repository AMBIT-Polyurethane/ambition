import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { saveCourse } from "@/app/(app)/admin/actions";
import { createLesson } from "@/app/(app)/admin/academy/actions";
import type { AcademyLesson, Course } from "@/lib/types";

export const metadata = { title: "Academy admin" };

function CourseFields({ c }: { c?: Course }) {
  return (
    <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      <label className="field" style={{ gridColumn: "span 2" }}><span className="label">Title</span><input className="input sm" name="title" defaultValue={c?.title ?? ""} required /></label>
      <label className="field"><span className="label">Status</span>
        <select className="select sm" name="status" defaultValue={c?.status ?? "coming_soon"}>
          <option value="coming_soon">Coming soon</option>
          <option value="live">Live</option>
        </select>
      </label>
      <label className="field" style={{ gridColumn: "span 2" }}><span className="label">Subtitle</span><input className="input sm" name="subtitle" defaultValue={c?.subtitle ?? ""} /></label>
      <label className="field"><span className="label">Who sees it</span>
        <select className="select sm" name="audience" defaultValue={c?.audience ?? "all"}>
          <option value="all">Everyone</option>
          <option value="customer">Contractors</option>
          <option value="employee">AMBIT staff</option>
        </select>
      </label>
      <label className="field"><span className="label">Lessons</span><input className="input sm" name="lessons" type="number" defaultValue={c?.lessons ?? ""} /></label>
      <label className="field"><span className="label">Minutes</span><input className="input sm" name="minutes" type="number" defaultValue={c?.minutes ?? ""} /></label>
      <label className="field"><span className="label">Sort</span><input className="input sm" name="sort" type="number" defaultValue={c?.sort ?? 0} /></label>
      <label className="field" style={{ gridColumn: "1 / -1" }}><span className="label">Link (until lessons are built in-app)</span><input className="input sm" name="url" defaultValue={c?.url ?? ""} placeholder="https://…" /></label>
    </div>
  );
}

type Row = Course & { academy_lessons?: AcademyLesson[] | null };

export default async function AcademyAdminPage() {
  const { supabase } = await requireAdmin();
  let { data, error } = await supabase.from("courses").select("*, academy_lessons(*)").order("sort");
  const ready = !error; // false until migration 0054 has been run
  if (error) ({ data } = await supabase.from("courses").select("*").order("sort"));
  const courses = (data ?? []) as Row[];
  return (
    <main className="shell wide">
      <TopBar title="Academy courses" back="/admin" />
      {!ready ? <div className="alert err">Lessons and quizzes need update 0054 run in Supabase first.</div> : null}
      <details className="card">
        <summary><b>+ Add a course</b></summary>
        <form action={saveCourse} className="col" style={{ marginTop: 14 }}><CourseFields /><div><Submit className="btn sm">Add course</Submit></div></form>
      </details>
      {courses.map((c) => {
        const all = c.academy_lessons ?? [];
        const lessons = all.filter((l) => !l.translation_of).sort((a, b) => a.number - b.number);
        const versions = (l: AcademyLesson) => all.filter((v) => v.translation_of === l.id);
        return (
          <section key={c.id} className="section">
            <div className="eyebrow">{c.title}</div>
            <div className="list">
              {lessons.map((l) => (
                <div key={l.id}>
                  <Link href={`/admin/academy/lesson/${l.id}`} className="item">
                    <div className="ic lesson-num">{l.number}</div>
                    <div className="grow">
                      <div className="t">{l.title}</div>
                      <div className="s">{l.video_path ? "Video uploaded" : "No video yet"}</div>
                    </div>
                    {l.status === "live" ? <span className="pill ok">Live</span> : <span className="pill warn">Draft</span>}
                  </Link>
                  {versions(l).map((v) => (
                    <Link key={v.id} href={`/admin/academy/lesson/${v.id}`} className="item" style={{ paddingLeft: 32 }}>
                      <div className="ic lesson-num" style={{ fontSize: 12 }}>ES</div>
                      <div className="grow">
                        <div className="t">{v.title}</div>
                        <div className="s">Spanish version · {v.video_path ? "Video uploaded" : "No video yet"}</div>
                      </div>
                      {v.status === "live" ? <span className="pill ok">Live</span> : <span className="pill warn">Draft</span>}
                    </Link>
                  ))}
                </div>
              ))}
              {ready ? (
                <details>
                  <summary className="item" style={{ minHeight: 52 }}><span className="small red"><b>+ Add a lesson</b></span></summary>
                  <form action={createLesson} className="row wrap" style={{ padding: "0 16px 16px", alignItems: "flex-end" }}>
                    <input type="hidden" name="course_id" value={c.id} />
                    <label className="field grow"><span className="label">Lesson title</span><input className="input sm" name="title" required /></label>
                    <Submit className="btn sm">Add lesson</Submit>
                  </form>
                </details>
              ) : null}
              <details>
                <summary className="item" style={{ minHeight: 52 }}>
                  <div className="grow"><div className="s">Course details · {c.status === "live" ? "Live" : "Coming soon"}</div></div>
                  <span className="small red">Edit</span>
                </summary>
                <form action={saveCourse} className="col" style={{ padding: "0 16px 16px" }}>
                  <input type="hidden" name="id" value={c.id} />
                  <CourseFields c={c} />
                  <div><Submit className="btn sm">Save</Submit></div>
                </form>
              </details>
            </div>
          </section>
        );
      })}
    </main>
  );
}
