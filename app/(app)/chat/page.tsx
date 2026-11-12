import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { claudeReady } from "@/lib/ai/claude";
import { myTodos, overview } from "@/lib/chat";
import { ChatList } from "@/components/chat/list";
import { AskChat } from "@/components/chat/ask";
import { PushToggle } from "@/components/push-toggle";

export const metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

/** Team Chat: the list of conversations (on a computer, with search and notifications beside it). */
export default async function ChatPage() {
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
        <Link href="/chat/new" className="btn"><MessageSquarePlus size={17} /> New message</Link>
        <AskChat aiReady={claudeReady()} />
        <div className="card"><PushToggle /></div>
      </div>
    </main>
  );
}
