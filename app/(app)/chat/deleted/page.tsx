import { CircleAlert, CircleCheck } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateTime } from "@/lib/format";
import { chatRestore } from "../actions";

export const metadata = { title: "Deleted direct messages" };
export const dynamic = "force-dynamic";

type Row = { channel_id: string; user_id: string; user_name: string; with_names: string | null; hidden_at: string | null; back: boolean; hidden_count: number; last_message_at: string | null };

/** Admins: direct messages someone deleted (0064). Restore brings the chat and its history back for that person. */
export default async function DeletedChatsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("chat_hidden_list");
  const rows = (data ?? []) as Row[];
  return (
    <main className="shell">
      <TopBar title="Deleted direct messages" back="/chat" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <p className="small muted">
        When someone deletes a direct message it leaves their Chat list, and the messages up to then are hidden for them only (the other
        person keeps everything). Restore brings the chat and all of its messages back for that person.
      </p>
      {error ? (
        <Empty icon="message" title="This needs the 0064 database update">Ask Jeremiah to run it.</Empty>
      ) : rows.length === 0 ? (
        <Empty icon="message" title="Nobody has deleted a chat" />
      ) : (
        <div className="list">
          {rows.map((r) => (
            <div key={`${r.channel_id}-${r.user_id}`} className="item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="t ellipsis">{r.user_name} · with {r.with_names ?? "(no one)"}</span>
                  <span className={`pill ${r.back ? "" : "warn"}`}>{r.back ? "Came back" : "Deleted"}</span>
                </div>
                <div className="s">
                  {r.hidden_count} {r.hidden_count === 1 ? "message" : "messages"} hidden for {r.user_name.split(" ")[0]}
                  {r.hidden_at ? ` · deleted ${dateTime(r.hidden_at)}` : r.back ? " · a new message brought the chat back" : ""}
                </div>
              </div>
              <form action={chatRestore}>
                <input type="hidden" name="channel" value={r.channel_id} />
                <input type="hidden" name="user" value={r.user_id} />
                <Submit className="btn sm" pendingText="Restoring…">Restore</Submit>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
