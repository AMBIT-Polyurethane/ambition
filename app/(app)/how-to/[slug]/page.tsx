import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { HOWTO, clock, howtoBySlug, howtoPath, howtoPoster } from "@/lib/howto";
import { HowToPlayer, HowToUpload } from "@/components/howto/player";

export const metadata = { title: "How To Use A.I." };

export default async function HowToVideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = howtoBySlug(slug);
  if (!v) notFound();
  const { supabase, profile } = await requireEmployee();
  const admin = profile.role === "admin";
  const { data } = await supabase.storage.from("academy").createSignedUrl(howtoPath(v.slug), 60 * 60 * 6);
  const src = data?.signedUrl ?? null;
  const next = HOWTO.find((x) => x.n === v.n + 1) ?? null;

  return (
    <main className="shell">
      <TopBar title="How To Use A.I." back="/how-to" />
      <div className="col" style={{ gap: 4 }}>
        <div className="eyebrow">Video {v.n} of {HOWTO.length} · {clock(v.seconds)}</div>
        <h1 className="howto-h1">{v.title}</h1>
        <div className="muted small">{v.who}</div>
      </div>

      {src ? (
        <HowToPlayer slug={v.slug} src={src} poster={howtoPoster(v.slug)} chapters={v.chapters} />
      ) : (
        <div className="card lesson-video empty-video">
          <div className="col center" style={{ gap: 6, padding: 20 }}>
            <b>Coming soon</b>
            <span className="small muted">This video hasn&apos;t been uploaded yet.</span>
          </div>
        </div>
      )}

      {admin ? <HowToUpload slug={v.slug} has={!!src} /> : null}

      {next ? (
        <Link href={`/how-to/${next.slug}`} className="list" style={{ textDecoration: "none" }}>
          <div className="item">
            <div className="grow">
              <div className="s">Next video</div>
              <div className="t">{next.title}</div>
            </div>
            <ChevronRight size={18} className="chev" />
          </div>
        </Link>
      ) : (
        <Link href="/how-to" className="btn ghost">Back to all videos</Link>
      )}
    </main>
  );
}
