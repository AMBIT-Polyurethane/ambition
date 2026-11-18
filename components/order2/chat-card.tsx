import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { OrderChatOpen } from "@/components/chat/order-button";
import { loadMessages, staffList, type ChatMsg, type Staff } from "@/lib/chat";
import { OrderChatCompose } from "@/components/order2/chat-compose";

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/** Message text with @Full Name shown as a blue tag. */
export function MentionText({ body, staff }: { body: string; staff: Staff[] }) {
  const names = staff.map((s) => s.name).filter((n) => body.includes(`@${n}`)).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{body}</>;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  return <>{body.split(re).map((part, i) => (i % 2 ? <span key={i} className="at2">{part}</span> : part))}</>;
}

/** The order's team chat, beside the order: the last few messages and a way in. */
export async function ChatCard({ db, orderId, me, meName }: { db: SupabaseClient; orderId: string; me: string; meName: string }) {
  const [{ data: found }, staff] = await Promise.all([
    db.from("chat_channels").select("id").eq("order_id", orderId).maybeSingle<{ id: string }>(),
    staffList(db),
  ]);
  // Nobody has opened it yet: make it now, so the box below works straight away.
  let chan = found;
  if (!chan) {
    const { data } = await db.rpc("chat_order", { p_order: orderId });
    chan = data ? { id: String(data) } : null;
  }
  let msgs: ChatMsg[] = [];
  if (chan) msgs = (await loadMessages(db, chan.id, me, new Map(staff.map((s) => [s.id, s.name])), { limit: 5 })).filter((m) => !m.deleted_at);
  return (
    <aside className="card2 chat2" aria-label="Order chat">
      <div className="card2-h">
        <b>Order chat</b>
        <MessagesSquare size={18} style={{ color: "var(--text3)" }} />
      </div>
      {msgs.length ? (
        <div className="chat2-l">
          {msgs.map((m) =>
            m.kind === "system" || m.kind === "handoff" ? (
              <div key={m.id} className="chat2-sys">
                <span className="chat2-sys-i"><ArrowRight size={15} strokeWidth={2.4} /></span>
                <span className="col" style={{ gap: 2 }}>
                  <span><MentionText body={m.body} staff={staff} /></span>
                  <span className="t">{m.kind === "handoff" ? "Automatic · " : ""}{time(m.created_at)}</span>
                </span>
              </div>
            ) : (
              <div key={m.id} className="chat2-m">
                <span className="chat2-av">{initials(m.by || "?")}</span>
                <span className="col" style={{ gap: 3, minWidth: 0 }}>
                  <span className="t"><b>{m.user_id === me ? "You" : m.by}</b> · {time(m.created_at)}</span>
                  <span className="chat2-b">{m.body ? <MentionText body={m.body} staff={staff} /> : m.files.length ? `📎 ${m.files.length} file${m.files.length > 1 ? "s" : ""}` : ""}</span>
                </span>
              </div>
            ),
          )}
        </div>
      ) : (
        <p className="up2-sub" style={{ margin: 0, padding: "16px 18px 0" }}>No messages yet. Type @ to tag someone.</p>
      )}
      {chan ? <OrderChatCompose roomId={chan.id} me={{ id: me, name: meName }} staff={staff} aiReady={false} /> : null}
      <div className="chat2-f">
        <OrderChatOpen orderId={orderId} channel={chan?.id ?? null} className="b2 sm quiet block">
          <MessagesSquare size={16} /> Open the full chat
        </OrderChatOpen>
      </div>
    </aside>
  );
}
