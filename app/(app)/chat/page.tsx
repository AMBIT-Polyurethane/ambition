import Link from "next/link";
import { CircleCheck, MessageSquarePlus, Trash2 } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { claudeReady } from "@/lib/ai/claude";
import { myTodos, overview } from "@/lib/chat";
import { ChatList } from "@/components/chat/list";
import { AskChat } from "@/components/chat/ask";
import { PushToggle } from "@/components/push-toggle";

export const metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

/** Team Chat: the list of conversations (on a computer, with search and notifications beside it). */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const [{ rows, ready }, todos] = await Promise.all([overview(supabase), myTodos(supabase, profile.id)]);
  if (!ready) {
    return (
      <main className="shell">
        <h1 className="howto-h1">Chat</h1>
        <div className="alert warn small">Chat needs the 0063 database update. Ask Jeremiah to run it.</div>
      </main>
    );
  }
  return (
    <main className="chat-shell">
      <ChatList rows={rows} isAdmin={profile.role === "admin"} todos={todos.length} />
      <div className="chat-home">
        <div className="col" style={{ gap: 6 }}>
          <div className="eyebrow">AMBIT employees</div>
          <h1 className="howto-h1">Team chat</h1>
          <p className="small muted" style={{ margin: 0 }}>
            Channels for each team or job, direct messages, and a conversation board on every order. @mention someone and it lands on their to-do list.
          </p>
        </div>
        {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
        <Link href="/chat/new" className="btn"><MessageSquarePlus size={17} /> New message</Link>
        <AskChat aiReady={claudeReady()} />
        <div className="card"><PushToggle /></div>
        {profile.role === "admin" ? (
          <Link href="/chat/deleted" className="linkbtn small" style={{ alignSelf: "flex-start" }}><Trash2 size={14} /> Deleted direct messages (admins)</Link>
        ) : null}
      </div>
    </main>
  );
}
