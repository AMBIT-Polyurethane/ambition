import { requireEmployee } from "@/lib/session";
import { myTodos, overview } from "@/lib/chat";
import { ChatList } from "@/components/chat/list";
import { TodoList } from "@/components/chat/todos";

export const metadata = { title: "My to-dos" };
export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const { supabase, profile } = await requireEmployee();
  const [{ rows }, open, done] = await Promise.all([overview(supabase), myTodos(supabase, profile.id), myTodos(supabase, profile.id, { done: true, limit: 20 })]);
  return (
    <main className="chat-shell in-room">
      <ChatList rows={rows} isAdmin={profile.role === "admin"} todos={open.length} />
      <div className="chat-home">
        <div className="col" style={{ gap: 6 }}>
          <div className="eyebrow">From chat</div>
          <h1 className="howto-h1">My to-dos</h1>
          <p className="small muted" style={{ margin: 0 }}>When someone @mentions you, AMBIT Intelligence turns what they asked into a to-do here (and on your Home screen). Check it off when it&apos;s done.</p>
        </div>
        <section className="card"><TodoList todos={open} /></section>
        {done.length ? (
          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Done lately</div>
            <div className="card"><TodoList todos={done} adding={false} compact /></div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
