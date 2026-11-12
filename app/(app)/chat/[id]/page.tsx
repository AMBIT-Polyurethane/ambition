import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { claudeReady } from "@/lib/ai/claude";
import { channelTitle, loadMessages, myTodos, overview, staffList, type ChannelRow } from "@/lib/chat";
import { ChatList } from "@/components/chat/list";
import { ChatRoom, type RoomInfo } from "@/components/chat/room";
import { STAGES, stageOf } from "@/lib/order-desk";
import type { Order } from "@/lib/types";

export const metadata = { title: "Chat" };
export const dynamic = "force-dynamic";


export default async function ChatRoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, profile } = await requireEmployee();
  const [{ rows }, staff, todos, { data: ch }, { data: mem }] = await Promise.all([
    overview(supabase),
    staffList(supabase),
    myTodos(supabase, profile.id),
    supabase.from("chat_channels").select("id, kind, name, about, private, order_id, archived_at").eq("id", id).maybeSingle(),
    supabase.from("chat_members").select("user_id, notify, last_read_id").eq("channel_id", id),
  ]);
  if (!ch) notFound();
  const members = (mem ?? []) as { user_id: string; notify: "all" | "mentions" | "none"; last_read_id: number }[];
  const mine = members.find((m) => m.user_id === profile.id);
  const row = rows.find((r) => r.id === id);
  const names = new Map(staff.map((s) => [s.id, s.name]));
  let order: RoomInfo["order"] = null;
  if (ch.order_id) {
    const { data: o } = await supabase.from("orders").select("*").eq("id", ch.order_id).maybeSingle();
    if (o) {
      const st = stageOf(o as Order);
      order = { id: o.id as string, no: Number(o.order_no), company: o.company_name as string, status: st ? STAGES[st].short : String(o.status) };
    }
  }
  const people = ch.kind === "dm" ? members.filter((m) => m.user_id !== profile.id).map((m) => names.get(m.user_id) ?? "Former employee").join(", ") : null;
  const room: RoomInfo = {
    id,
    kind: ch.kind as RoomInfo["kind"],
    title: channelTitle({ kind: ch.kind as ChannelRow["kind"], name: ch.name as string, people }),
    about: (ch.about as string | null) ?? null,
    private: Boolean(ch.private),
    archived: Boolean(ch.archived_at),
    order,
  };
  const focus = { m: Number(sp.m) || undefined, t: Number(sp.t) || undefined };
  // Opened from a link to an older message: load from a little before it.
  const initial = await loadMessages(supabase, id, profile.id, names, focus.m ? { from: Math.max(1, focus.m - 30), limit: 200 } : {});
  return (
    <main className="chat-shell in-room">
      <ChatList rows={rows} isAdmin={profile.role === "admin"} todos={todos.length} />
      <ChatRoom
        me={{ id: profile.id, name: profile.full_name || profile.email }}
        room={room}
        member={Boolean(mine)}
        notify={mine?.notify ?? "all"}
        lastRead={mine?.last_read_id ?? 0}
        isAdmin={profile.role === "admin"}
        staff={staff}
        members={members.map((m) => m.user_id)}
        initial={initial}
        focus={focus}
        aiReady={claudeReady()}
      />
    </main>
  );
}
