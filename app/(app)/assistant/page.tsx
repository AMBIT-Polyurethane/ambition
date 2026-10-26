import Link from "next/link";
import { requireActive, isEmployee } from "@/lib/session";
import { aiKeySet, canUseAssistant, loadAiSettings } from "@/lib/assistant/settings";
import { AssistantChat, type ChatMessage, type ChatThread } from "@/components/assistant/chat";
import { BrandImg } from "@/components/brand";

export const metadata = { title: "Ask AMBIT" };
export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const settings = await loadAiSettings(supabase);
  const staff = isEmployee(profile);
  const admin = profile.role === "admin";

  if (!settings || !canUseAssistant(profile, settings)) {
    return (
      <main className="shell">
        <div className="ai-hello" style={{ paddingTop: 40 }}>
          <BrandImg art="atom-mark" width={64} height={64} />
          <h2>Ask AMBIT is coming soon</h2>
          <p>
            {!settings && admin
              ? "Run supabase/migrations/0020_assistant.sql in Supabase (SQL Editor) to turn it on."
              : "AMBIT's assistant for products, building science, codes and the app is being tested by the AMBIT team. It'll be here soon."}
          </p>
          <Link href="/" className="btn dark sm">Back home</Link>
        </div>
      </main>
    );
  }

  const threadId = sp.t && /^[0-9a-f-]{36}$/i.test(sp.t) ? sp.t : null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "UTC" });
  const [{ data: threadRows }, msgRes, qRes, { data: usage }] = await Promise.all([
    supabase.from("ai_threads").select("id, title, unread, updated_at").eq("user_id", profile.id).order("updated_at", { ascending: false }).limit(50),
    threadId
      ? supabase.from("ai_messages").select("id, role, body, sources, no_source, rating, author_name, created_at, images, parts").eq("thread_id", threadId).order("id")
      : Promise.resolve({ data: [] }),
    threadId ? supabase.from("ai_questions").select("message_id, status").eq("thread_id", threadId) : Promise.resolve({ data: [] }),
    supabase.from("ai_usage").select("questions").eq("user_id", profile.id).eq("day", today).maybeSingle(),
  ]);
  const threads = (threadRows ?? []) as ChatThread[];
  const known = threadId && threads.some((t) => t.id === threadId) ? threadId : null;
  type Row = Omit<ChatMessage, "images" | "complaint"> & { images: string[] | null; parts: { complaint?: boolean } | null };
  const rows = known ? ((msgRes.data ?? []) as Row[]) : [];
  // Photo links last an hour; reopening the conversation makes fresh ones.
  const paths = rows.flatMap((r) => r.images ?? []);
  const signed = paths.length ? (await supabase.storage.from("photos").createSignedUrls(paths, 60 * 60)).data ?? [] : [];
  const messages: ChatMessage[] = rows.map(({ images, parts, ...r }) => ({
    ...r,
    images: images?.map((p) => signed.find((x) => x.path === p)?.signedUrl).filter((u): u is string => !!u) ?? null,
    complaint: !!parts?.complaint,
  }));
  const sent: Record<string, string> = {};
  for (const q of (qRes.data ?? []) as { message_id: number | null; status: string }[]) if (q.message_id) sent[String(q.message_id)] = q.status;
  const limit = staff ? settings.daily_limit_staff : settings.daily_limit_customer;
  const used = (usage as { questions?: number } | null)?.questions ?? 0;

  return (
    <AssistantChat
      key={known ?? "new"}
      threads={threads}
      threadId={known}
      messages={messages}
      sentToExpert={sent}
      configured={aiKeySet()}
      left={limit - used}
      staff={staff}
      admin={admin}
    />
  );
}
