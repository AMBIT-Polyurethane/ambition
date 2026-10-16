import { ChevronRight } from "lucide-react";
import { requireActive } from "@/lib/session";
import { Icon } from "@/components/icons";
import type { Course } from "@/lib/types";

export const metadata = { title: "AMBIT Academy" };

const ICONS = ["book", "drum", "layers", "headset", "shield", "academy"];

export default async function AcademyPage() {
  const { supabase } = await requireActive();
  const { data } = await supabase.from("courses").select("*").order("sort");
  const courses = (data ?? []) as Course[];

  return (
    <main className="shell">
      <div className="col" style={{ alignItems: "center", gap: 10, paddingTop: 10 }}>
        <img src="/brand/academy-mark.png" alt="" style={{ width: 150, height: "auto" }} />
        <div className="wordmark" style={{ fontSize: 22 }}>AMBIT <span>ACADEMY</span></div>
        <p className="muted small center" style={{ margin: 0, maxWidth: 340 }}>
          Short building-science courses with quizzes and certificates, for AMBIT staff and contractor crews.
        </p>
      </div>

      <section className="section">
        <div className="eyebrow">Courses</div>
        <div className="list">
          {courses.map((c, i) => {
            const live = c.status === "live" && c.url;
            const meta = [c.lessons ? `${c.lessons} lessons` : null, c.minutes ? `${c.minutes} min` : null].filter(Boolean).join(" · ");
            const inner = (
              <>
                <div className="ic"><Icon name={ICONS[i % ICONS.length]} /></div>
                <div className="grow">
                  <div className="t">{c.title}</div>
                  <div className="s">{c.subtitle}{meta ? ` · ${meta}` : ""}</div>
                </div>
                {live ? <ChevronRight size={18} className="chev" /> : <span className="pill grey">Soon</span>}
              </>
            );
            return live ? (
              <a key={c.id} className="item" href={c.url!} target="_blank" rel="noopener noreferrer">{inner}</a>
            ) : (
              <div key={c.id} className="item">{inner}</div>
            );
          })}
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Lessons, quizzes and certificates are being built in the next phase of AMBITION.</p>
      </section>
    </main>
  );
}
