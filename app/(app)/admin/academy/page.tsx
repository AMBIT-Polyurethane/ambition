import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { saveCourse } from "@/app/(app)/admin/actions";
import type { Course } from "@/lib/types";

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

export default async function AcademyAdminPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("courses").select("*").order("sort");
  const courses = (data ?? []) as Course[];
  return (
    <main className="shell wide">
      <TopBar title="Academy courses" back="/admin" />
      <details className="card">
        <summary><b>+ Add a course</b></summary>
        <form action={saveCourse} className="col" style={{ marginTop: 14 }}><CourseFields /><div><Submit className="btn sm">Add course</Submit></div></form>
      </details>
      <div className="list">
        {courses.map((c) => (
          <details key={c.id}>
            <summary className="item" style={{ minHeight: 56 }}>
              <div className="grow"><div className="t">{c.title}</div><div className="s">{c.status === "live" ? "Live" : "Coming soon"}</div></div>
              <span className="small red">Edit</span>
            </summary>
            <form action={saveCourse} className="col" style={{ padding: "0 16px 16px" }}>
              <input type="hidden" name="id" value={c.id} />
              <CourseFields c={c} />
              <div><Submit className="btn sm">Save</Submit></div>
            </form>
          </details>
        ))}
      </div>
    </main>
  );
}
