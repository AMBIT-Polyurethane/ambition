import { requireEmployee } from "@/lib/session";
import { overview, staffList, myTodos } from "@/lib/chat";
import { ChatList } from "@/components/chat/list";
import { NewChat } from "@/components/chat/new";

export const metadata = { title: "New message" };
export const dynamic = "force-dynamic";

export default async function NewChatPage() {
  const { supabase, profile } = await requireEmployee();
  const [{ rows }, staff, todos] = await Promise.all([overview(supabase), staffList(supabase), myTodos(supabase, profile.id)]);
  return (
    <main className="chat-shell in-room">
      <ChatList rows={rows} isAdmin={profile.role === "admin"} todos={todos.length} />
      <div className="chat-home">
        <NewChat staff={staff.filter((s) => s.id !== profile.id)} isAdmin={profile.role === "admin"} />
      </div>
    </main>
  );
}
