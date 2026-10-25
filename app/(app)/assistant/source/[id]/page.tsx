import { notFound, redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Markdown } from "@/components/assistant/markdown";
import { kindInfo } from "@/lib/assistant/config";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Ask AMBIT source" };
export const dynamic = "force-dynamic";

// Where a numbered source under an answer leads: an AMBIT document, a PDF added for the assistant,
// or a piece of teaching written in the app.
export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireActive();
  const { data: s } = await supabase
    .from("ai_sources")
    .select("id, kind, origin, title, document_id, storage_path, body, created_by_name, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();

  if (s.document_id) redirect(`/docs/open/${s.document_id}`);
  if (s.storage_path) {
    const { data } = await supabase.storage.from("knowledge").createSignedUrl(s.storage_path, 60 * 10);
    if (data?.signedUrl) redirect(data.signedUrl);
    notFound();
  }

  return (
    <main className="shell">
      <TopBar title={s.title} back="/assistant" />
      <div className="card col">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="pill">{kindInfo(s.kind).label}</span>
          {s.origin === "answer" ? <span className="pill grey">Expert answer</span> : null}
        </div>
        <Markdown text={s.body ?? ""} />
        <p className="tiny faint" style={{ margin: 0 }}>
          {s.created_by_name ? `By ${s.created_by_name} · ` : ""}
          {dateTime(s.updated_at ?? s.created_at)}
        </p>
      </div>
    </main>
  );
}
