"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ClipboardList, Hash, ListTodo, Lock, Plus, Search, Users } from "lucide-react";
import type { ChannelRow } from "@/lib/chat";

// The list of conversations: channels, direct messages and order boards, unread ones in bold with counts.

const title = (c: ChannelRow) => (c.kind === "dm" ? c.people || "Just you" : c.name);
const ago = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) === today
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
};

export function ChatList({ rows, isAdmin, todos }: { rows: ChannelRow[]; isAdmin: boolean; todos: number }) {
  const path = usePathname() || "";
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => `${title(r)} ${r.about ?? ""} ${r.preview ?? ""}`.toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  const channels = shown.filter((r) => r.kind === "channel" && (r.member || r.private) && !r.archived);
  const browse = shown.filter((r) => r.kind === "channel" && !r.member && !r.private && !r.archived);
  const dms = shown.filter((r) => r.kind === "dm");
  const orders = shown.filter((r) => r.kind === "order");
  const archived = shown.filter((r) => r.kind === "channel" && r.archived);

  const Row = ({ r }: { r: ChannelRow }) => {
    const on = path === `/chat/${r.id}`;
    const hot = r.unread > 0 || r.mentions > 0;
    const I = r.kind === "dm" ? Users : r.kind === "order" ? ClipboardList : r.private ? Lock : Hash;
    return (
      <Link href={`/chat/${r.id}`} className={`chat-li${on ? " on" : ""}${hot ? " hot" : ""}${r.notify === "none" ? " muted" : ""}`}>
        <span className="chat-li-ic"><I size={16} /></span>
        <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
          <span className="row between" style={{ gap: 8 }}>
            <span className="chat-li-t ellipsis">{title(r)}</span>
            <span className="tiny faint nowrap">{ago(r.last_message_at)}</span>
          </span>
          <span className="tiny muted ellipsis">{r.preview ? `${r.preview_by ? `${r.preview_by.split(" ")[0]}: ` : ""}${r.preview}` : r.about ?? ""}</span>
        </span>
        {r.mentions > 0 ? <span className="chat-badge at">@{r.mentions}</span> : r.unread > 0 ? <span className={`chat-badge${r.kind === "channel" && r.notify !== "all" ? " soft" : ""}`}>{r.unread}</span> : null}
      </Link>
    );
  };
  const Sec = ({ label, list, empty }: { label: string; list: ChannelRow[]; empty?: string }) =>
    list.length || empty ? (
      <div className="chat-sec">
        <div className="eyebrow">{label}</div>
        {list.length ? list.map((r) => <Row key={r.id} r={r} />) : <span className="tiny muted" style={{ padding: "4px 10px" }}>{empty}</span>}
      </div>
    ) : null;

  return (
    <nav className="chat-list" aria-label="Conversations">
      <div className="chat-list-top">
        <b className="chat-list-h">Chat</b>
        <Link href="/chat/new" className="btn sm"><Plus size={15} /> New</Link>
      </div>
      <div className="xr-search chat-list-search">
        <Search size={15} />
        <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a conversation" aria-label="Find a conversation" />
      </div>
      <Link href="/chat/todos" className={`chat-li todo${path === "/chat/todos" ? " on" : ""}`}>
        <span className="chat-li-ic"><ListTodo size={16} /></span>
        <span className="grow chat-li-t">My to-dos</span>
        {todos ? <span className="chat-badge">{todos}</span> : null}
      </Link>
      <Sec label="Channels" list={channels} empty={isAdmin ? "Make the first one with New." : "No channels yet."} />
      <Sec label="Direct messages" list={dms} empty="Start one with New." />
      <Sec label="Order boards" list={orders} />
      <Sec label="More channels you can join" list={browse} />
      <Sec label="Archived" list={archived} />
    </nav>
  );
}
