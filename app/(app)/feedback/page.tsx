import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { FeedbackDesk } from "@/components/feedback/feedback-desk";
import type { FeedbackRow } from "@/lib/feedback";

export const metadata = { title: "Feedback" };
export const dynamic = "force-dynamic";

const COLS = "id, kind, area, subject, body, by_id, by_name, status, reply, reply_by_name, replied_at, seen_reply_at, created_at";

/** Team > Feedback (0117): admins send ideas, questions, concerns and problems to Jeremiah; he answers here. */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (profile.role !== "admin") redirect("/");
  const [mineRes, setRes] = await Promise.all([
    supabase.from("feedback").select(COLS).eq("by_id", profile.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("feedback_settings").select("owner_id, owner:profiles(full_name)").eq("id", 1).maybeSingle(),
  ]);
  const needs0117 = Boolean(mineRes.error);
  const set = setRes.data as { owner_id: string | null; owner: { full_name: string | null } | null } | null;
  const owner = !needs0117 && (!set?.owner_id || set.owner_id === profile.id);
  const ownerName = set?.owner?.full_name ?? "Jeremiah Bryant";
  const { data: all } = owner ? await supabase.from("feedback").select(COLS).order("created_at", { ascending: false }).limit(500) : { data: [] };

  return (
    <main className="shell wide">
      <TopBar title="Feedback" back="/" />
      {needs0117 ? <div className="alert warn small" role="note"><span>Feedback needs database update 0117 first (Supabase › SQL Editor).</span></div> : null}
      <FeedbackDesk
        mine={(mineRes.data ?? []) as FeedbackRow[]}
        inbox={owner ? ((all ?? []) as FeedbackRow[]) : null}
        ownerName={ownerName}
        meId={profile.id}
        startInbox={owner && sp.inbox === "1"}
        off={needs0117}
      />
    </main>
  );
}
