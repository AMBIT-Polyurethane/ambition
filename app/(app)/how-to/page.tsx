import Link from "next/link";
import { CirclePlay } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { roleLabel } from "@/lib/access";
import { HOWTO, HOWTO_FOLDER, clock, howtoThumb, type HowToVideo } from "@/lib/howto";
import { HowToBulkUpload, WatchedMark } from "@/components/howto/player";

export const metadata = { title: "How To Use A.I." };

/** "How To Use A.I.": short walkthroughs of the app for AMBIT employees (contractors never see this tab). */
export default async function HowToPage() {
  const { supabase, profile } = await requireEmployee();
  const admin = profile.role === "admin";
  const { data: files } = await supabase.storage.from("academy").list(HOWTO_FOLDER, { limit: 200 });
  const have = new Set((files ?? []).map((f) => f.name));
  const ready = (v: HowToVideo) => have.has(`${v.slug}.mp4`);

  // Their job's videos first; admins and anyone without a job role just get the full list.
  const role = profile.job_role && profile.job_role !== "admin" ? profile.job_role : null;
  const mine = role ? HOWTO.filter((v) => v.roles.includes(role)) : [];
  const rest = mine.length ? HOWTO.filter((v) => !mine.includes(v)) : HOWTO;
  const missing = HOWTO.filter((v) => !ready(v)).length;

  const card = (v: HowToVideo) => (
    <Link key={v.slug} href={`/how-to/${v.slug}`} className="howto-card">
      <div className="howto-thumb">
        <img src={howtoThumb(v.slug)} alt="" loading="lazy" />
        <span className="howto-play"><CirclePlay size={44} strokeWidth={1.6} /></span>
        <span className="howto-len">{clock(v.seconds)}</span>
      </div>
      <div className="howto-body">
        <div className="howto-kick">
          <span>Video {v.n}</span>
          <WatchedMark slug={v.slug} />
          {!ready(v) ? <span className="pill grey">{admin ? "Needs upload" : "Coming soon"}</span> : null}
        </div>
        <div className="howto-title">{v.title}</div>
        <div className="howto-who">{v.who}</div>
        <p className="howto-blurb">{v.blurb}</p>
      </div>
    </Link>
  );

  return (
    <main className="shell">
      <div className="col" style={{ gap: 6, paddingTop: 6 }}>
        <div className="eyebrow">AMBIT employees</div>
        <h1 className="howto-h1">How To Use A.I.</h1>
        <p className="muted small" style={{ margin: 0, maxWidth: 560 }}>
          Short walkthroughs of AMBIT Intelligence, recorded right in the app. Tap a video to watch it, or jump straight to the step you need.
        </p>
      </div>

      {admin && missing ? (
        <div className="alert warn small" role="status">
          <span>{missing} video{missing === 1 ? " hasn't" : "s haven't"} been uploaded yet. Use Upload videos below (only admins see this).</span>
        </div>
      ) : null}
      {admin ? <HowToBulkUpload /> : null}

      {mine.length ? (
        <section className="section">
          <div className="eyebrow">For you · {roleLabel(role)}</div>
          <div className="howto-grid">{mine.map(card)}</div>
        </section>
      ) : null}

      <section className="section">
        {mine.length ? <div className="eyebrow">More videos</div> : null}
        <div className="howto-grid">{rest.map(card)}</div>
      </section>
    </main>
  );
}
