import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireActive } from "@/lib/session";
import { Icon } from "@/components/icons";
import type { Course } from "@/lib/types";
import { BrandImg } from "@/components/brand";

export const metadata = { title: "AMBIT Academy" };

const ICONS = ["book", "drum", "layers", "headset", "shield", "academy"];

type Row = Course & { academy_lessons?: { id: string; status: string }[] | null };

export default async function AcademyPage() {
  const { supabase, profile } = await requireActive();
  const admin = profile.role === "admin";
  // Lessons come with each course (only live ones for students; admins also get drafts). Before migration 0054
  // the embed fails, so fall back to the plain course list.
  let { data, error } = await supabase.from("courses").select("*, academy_lessons(id, status)").order("sort");
  if (error) ({ data } = await supabase.from("courses").select("*").order("sort"));
  const courses = (data ?? []) as Row[];

  return (
    <main className="shell">
      <div className="col" style={{ alignItems: "center", gap: 10, paddingTop: 10 }}>
        <BrandImg art="academy-mark" style={{ width: 150, height: "auto" }} />
        <div className="wordmark" style={{ fontSize: 22 }}>AMBIT <span>ACADEMY</span></div>
        <p className="muted small center" style={{ margin: 0, maxWidth: 340 }}>
          Short building-science lessons with graded quizzes, for AMBIT staff and contractor crews.
        </p>
      </div>

      <section className="section">
        <div className="eyebrow">Courses</div>
        <div className="list">
          {courses.map((c, i) => {
            const lessons = c.academy_lessons ?? [];
            const live = lessons.filter((l) => l.status === "live").length;
            const inApp = live > 0 || (admin && lessons.length > 0);
            const external = !inApp && c.status === "live" && c.url;
            const count = inApp ? (admin ? lessons.length : live) : c.lessons;
            const meta = [count ? `${count} lesson${count === 1 ? "" : "s"}` : null, c.minutes ? `${c.minutes} min` : null].filter(Boolean).join(" · ");
            const inner = (
              <>
                <div className="ic"><Icon name={ICONS[i % ICONS.length]} /></div>
                <div className="grow">
                  <div className="t">{c.title}</div>
                  <div className="s">{c.subtitle}{meta ? ` · ${meta}` : ""}</div>
                </div>
                {inApp || external ? <ChevronRight size={18} className="chev" /> : <span className="pill grey">Soon</span>}
              </>
            );
            if (inApp) return <Link key={c.id} className="item" href={`/academy/course/${c.id}`}>{inner}</Link>;
            if (external) return <a key={c.id} className="item" href={c.url!} target="_blank" rel="noopener noreferrer">{inner}</a>;
            return <div key={c.id} className="item">{inner}</div>;
          })}
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Each lesson is a short video and a quiz. Pass the quiz to finish the lesson; you can retake it as often as you like.</p>
      </section>
    </main>
  );
}
