"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowLeft, Bell, BellOff, Check, ClipboardList, Copy, FileText, Hash, ListTodo, LoaderCircle, Lock, MessageSquareReply, Mic, MoreHorizontal,
  Paperclip, Pencil, Pin, PinOff, Send, Settings, SmilePlus, Sparkles, Square, Trash2, Users, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import { canListen, useListen } from "@/components/ops/ai/voice";
import {
  chatCatchUp, chatDelete, chatDraft, chatEdit, chatJoin, chatMessages, chatNotify, chatPin, chatPost, chatReact, chatRead, chatSetMembers, chatThread,
  chatUpdateChannel, todoAdd,
} from "@/app/(app)/chat/actions";
import type { ChatFile, ChatMsg, Staff } from "@/lib/chat";

// One conversation: messages (live), threads, reactions, pins, photos and files, @mentions, the mic, and
// AMBIT Intelligence (catch me up, write my reply). Used for channels, direct messages and order boards.

export type RoomInfo = {
  id: string;
  kind: "channel" | "dm" | "order";
  title: string;
  about: string | null;
  private: boolean;
  archived: boolean;
  order: { id: string; no: number; company: string; status: string } | null;
};

const QUICK = ["👍", "✅", "👀", "🙏", "🔥", "❤️", "😂", "🎉"];
const TONES = ["#E33527", "#2563EB", "#0D9488", "#7C3AED", "#DB2777", "#CA8A04", "#16A34A", "#0891B2", "#4F46E5", "#EA580C"];
const tone = (id: string | null) => TONES[[...(id ?? "x")].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
function dayLabel(iso: string) {
  const k = dayKey(iso);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const y = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (k === today) return "Today";
  if (k === y) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/Chicago" });
}
const isImg = (f: ChatFile) => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|heic)$/i.test(f.name);
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Message text: links, @mentions and order numbers (ORD-1401) are live. */
function Body({ text, staff, me }: { text: string; staff: Staff[]; me: string }) {
  const names = useMemo(() => staff.map((s) => s.name).filter(Boolean).sort((a, b) => b.length - a.length), [staff]);
  const parts = useMemo(() => {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(https?://[^\\s<]+)|(ORD-\\d{3,7})|(@(?:${names.map(esc).join("|") || "\\u0000"}))|(\\*\\*[^*]+\\*\\*)`, "g");
    const out: { t: "text" | "url" | "ord" | "at" | "b"; v: string }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
      out.push({ t: m[1] ? "url" : m[2] ? "ord" : m[3] ? "at" : "b", v: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: "text", v: text.slice(last) });
    return out;
  }, [text, names]);
  const meName = staff.find((s) => s.id === me)?.name;
  return (
    <>
      {parts.map((p, i) =>
        p.t === "url" ? (
          <a key={i} href={p.v} target="_blank" rel="noopener noreferrer">{p.v}</a>
        ) : p.t === "ord" ? (
          <Link key={i} href={`/orders/no/${p.v.slice(4)}`} className="chat-ord">{p.v}</Link>
        ) : p.t === "at" ? (
          <span key={i} className={`chat-at${p.v.slice(1) === meName ? " me" : ""}`}>{p.v}</span>
        ) : p.t === "b" ? (
          <b key={i}>{p.v.slice(2, -2)}</b>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </>
  );
}

export function ChatRoom({
  me,
  room,
  member: memberStart,
  notify: notifyStart,
  lastRead,
  isAdmin,
  staff,
  members: membersStart,
  initial,
  focus,
  aiReady,
}: {
  me: { id: string; name: string };
  room: RoomInfo;
  member: boolean;
  notify: "all" | "mentions" | "none";
  lastRead: number;
  isAdmin: boolean;
  staff: Staff[];
  members: string[];
  initial: ChatMsg[];
  focus?: { m?: number; t?: number };
  aiReady: boolean;
}) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial);
  const [older, setOlder] = useState(initial.length >= 60);
  const [member, setMember] = useState(memberStart);
  const [notify, setNotify] = useState(notifyStart);
  const [members, setMembers] = useState(membersStart);
  const [thread, setThread] = useState<number | null>(focus?.t ?? null);
  const [threadMsgs, setThreadMsgs] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [live, setLive] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "pins" | "settings">(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [flash, setFlash] = useState<number | null>(focus?.m ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const sb = useMemo(() => createClient(), []);
  const readUpTo = useRef(lastRead);
  const rt = useRef<ReturnType<typeof sb.channel> | null>(null);
  const meStaff = staff.find((s) => s.id === me.id);

  // ---- loading and live updates
  const refresh = useCallback(async () => {
    const from = msgs[0]?.id;
    const fresh = await chatMessages(room.id, from ? { from } : {});
    setMsgs((prev) => {
      const before = prev.length ? prev[prev.length - 1].id : 0;
      const added = fresh.filter((m) => m.id > before && m.user_id !== me.id).length;
      if (added && !nearBottom()) setNewBelow((n) => n + added);
      return fresh.length || !prev.length ? fresh : prev;
    });
    if (thread) setThreadMsgs(await chatThread(thread));
  }, [msgs, room.id, thread, me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const ch = sb
      .channel(`room:${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${room.id}` }, () => refreshRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, () => refreshRef.current())
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { id: string; name: string };
        if (p.id !== me.id) setTyping((t) => ({ ...t, [p.name]: Date.now() }));
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    rt.current = ch;
    return () => {
      sb.removeChannel(ch);
    };
  }, [sb, room.id, me.id]);
  // Without a live connection, check every few seconds; with one, now and then just in case.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && refreshRef.current(), live ? 30000 : 5000);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => {
    const t = setInterval(() => setTyping((x) => Object.fromEntries(Object.entries(x).filter(([, at]) => Date.now() - at < 4000))), 1500);
    return () => clearInterval(t);
  }, []);
  // Thread opened (or opened from a link).
  useEffect(() => {
    if (!thread) return setThreadMsgs([]);
    chatThread(thread).then(setThreadMsgs);
  }, [thread]);

  // ---- scrolling and "read"
  const nearBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewBelow(0);
  };
  useLayoutEffect(() => {
    if (flash) {
      const el = document.getElementById(`m-${flash}`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        setTimeout(() => setFlash(null), 2500);
        return;
      }
    }
    toBottom();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
  useEffect(() => {
    if (atBottom) toBottom(true);
    if (member && lastId > readUpTo.current && document.visibilityState === "visible") {
      readUpTo.current = lastId;
      chatRead(room.id, lastId);
    }
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = async () => {
    if (!msgs.length) return;
    const el = scroller.current;
    const h = el?.scrollHeight ?? 0;
    const more = await chatMessages(room.id, { before: msgs[0].id });
    setOlder(more.length >= 60);
    setMsgs((m) => [...more, ...m]);
    requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - h));
  };

  // ---- actions on messages
  const act = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error ?? "That didn't work.");
    await refreshRef.current();
  };

  const pins = msgs.filter((m) => m.pinned_at && !m.deleted_at);
  const unreadFrom = lastRead > 0 ? msgs.find((m) => m.id > lastRead && m.user_id !== me.id && m.kind !== "system")?.id ?? null : null;
  const who = Object.keys(typing);
  const canPost = !room.archived;

  return (
    <section className={`chat-room${thread ? " with-thread" : ""}`}>
      <div className="chat-main">
        <header className="chat-head">
          <Link href="/chat" className="iconbtn chat-back" aria-label="All conversations">
            <ArrowLeft size={18} />
          </Link>
          <div className="grow col" style={{ gap: 1, minWidth: 0 }}>
            <b className="chat-title ellipsis">
              {room.kind === "channel" ? room.private ? <Lock size={15} /> : <Hash size={15} /> : room.kind === "dm" ? <Users size={15} /> : <ClipboardList size={15} />} {room.title}
            </b>
            <span className="tiny muted ellipsis">
              {room.order ? (
                <>
                  Order board · {room.order.status} · <Link href={`/orders/${room.order.id}`}>Open ORD-{room.order.no}</Link>
                </>
              ) : (
                room.about || (room.kind === "dm" ? "Direct message" : `${members.length} ${members.length === 1 ? "person" : "people"}`)
              )}
            </span>
          </div>
          {aiReady ? (
            <button type="button" className="btn sm dark chat-ai-btn" disabled={busy === "catch"} onClick={async () => {
              setBusy("catch");
              const r = await chatCatchUp(room.id, unreadFrom ? unreadFrom : null);
              setBusy(null);
              if (r.ok) setSummary(r.summary);
              else setError(r.error);
            }}>
              {busy === "catch" ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} <span className="hide-sm">Catch me up</span>
            </button>
          ) : null}
          <button type="button" className={`iconbtn${panel === "pins" ? " on" : ""}`} aria-label={`Pinned messages (${pins.length})`} onClick={() => setPanel(panel === "pins" ? null : "pins")}>
            <Pin size={17} />
            {pins.length ? <span className="chat-dot">{pins.length}</span> : null}
          </button>
          <button type="button" className={`iconbtn${panel === "settings" ? " on" : ""}`} aria-label="Conversation settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}>
            <Settings size={17} />
          </button>
        </header>

        {summary ? (
          <div className="chat-summary">
            <div className="row between"><b className="small"><Sparkles size={14} /> Catch me up</b><button type="button" className="iconbtn sm" aria-label="Close" onClick={() => setSummary(null)}><X size={15} /></button></div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>{summary}</div>
          </div>
        ) : null}

        {panel === "pins" ? (
          <div className="chat-panel">
            <b className="small">Pinned</b>
            {pins.length ? pins.map((m) => (
              <button key={m.id} type="button" className="chat-pin-row" onClick={() => document.getElementById(`m-${m.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}>
                <b className="tiny">{m.by}</b> <span className="tiny ellipsis">{m.body || "(file)"}</span>
              </button>
            )) : <span className="tiny muted">Nothing pinned yet. Tap ⋯ on a message and Pin it to keep it at hand (a delivery window, a gate code, a price).</span>}
          </div>
        ) : null}
        {panel === "settings" ? (
          <RoomSettings
            room={room} isAdmin={isAdmin} member={member} notify={notify} staff={staff} members={members}
            onNotify={async (m) => { const r = await chatNotify(room.id, m); if (r.ok) setNotify(m); else setError(r.error); }}
            onJoin={async (j) => { const r = await chatJoin(room.id, j); if (r.ok) { setMember(j); if (!j) router.push("/chat"); } else setError(r.error); }}
            onMembers={async (add, remove) => { const r = await chatSetMembers(room.id, add, remove); if (r.ok) setMembers((m) => [...new Set([...m.filter((x) => !remove.includes(x)), ...add])]); else setError(r.error); await refreshRef.current(); }}
            onSave={async (d) => { const r = await chatUpdateChannel(room.id, d); if (!r.ok) setError(r.error); else router.refresh(); }}
          />
        ) : null}

        <div className="chat-scroll" ref={scroller} onScroll={() => { const b = nearBottom(); setAtBottom(b); if (b) setNewBelow(0); }}>
          {older ? (
            <button type="button" className="chip sm chat-older" onClick={loadOlder}>Show earlier messages</button>
          ) : (
            <div className="chat-start">
              <b>{room.title}</b>
              <span className="tiny muted">
                {room.kind === "order" ? "Everything about this order, in one place: questions for the desk, the warehouse and the rep." : room.kind === "dm" ? "This is the start of your conversation." : room.about || "This is the start of the channel."}
              </span>
            </div>
          )}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const grouped = !newDay && prev && prev.user_id === m.user_id && prev.kind === m.kind && m.kind !== "system" && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60000;
            return (
              <div key={m.id}>
                {newDay ? <div className="chat-day"><span>{dayLabel(m.created_at)}</span></div> : null}
                {unreadFrom === m.id ? <div className="chat-new"><span>New</span></div> : null}
                <Message
                  m={m} me={me} staff={staff} grouped={Boolean(grouped)} flash={flash === m.id} isAdmin={isAdmin}
                  onThread={() => setThread(m.id)}
                  onReact={(e) => act("react", () => chatReact(m.id, e))}
                  onPin={() => act("pin", () => chatPin(m.id, !m.pinned_at))}
                  onEdit={(t) => act("edit", () => chatEdit(m.id, t))}
                  onDelete={() => act("delete", () => chatDelete(m.id))}
                  onTodo={() => act("todo", () => todoAdd((m.body || "Follow up").slice(0, 200), null, m.id))}
                />
              </div>
            );
          })}
        </div>
        {newBelow > 0 ? (
          <button type="button" className="chat-newbelow" onClick={() => toBottom(true)}><ArrowDown size={14} /> {newBelow} new</button>
        ) : null}
        <div className="chat-typing tiny muted">{who.length ? `${who.join(", ")} ${who.length === 1 ? "is" : "are"} typing…` : ""}</div>
        {error ? <div className="alert err small chat-err" role="alert"><span className="grow">{error}</span><button type="button" className="iconbtn sm" onClick={() => setError(null)} aria-label="Close"><X size={14} /></button></div> : null}
        {!member && room.kind === "channel" && !room.private ? (
          <div className="chat-joinbar">
            <span className="small muted">You&apos;re looking at #{room.title}.</span>
            <button type="button" className="btn sm" onClick={async () => { const r = await chatJoin(room.id, true); if (r.ok) setMember(true); else setError(r.error); }}>Join channel</button>
          </div>
        ) : null}
        {canPost ? (
          <Composer
            roomId={room.id} me={me} staff={staff} members={room.kind === "channel" && !room.private ? null : members} aiReady={aiReady} parent={null}
            placeholder={room.kind === "dm" ? `Message ${room.title}` : room.kind === "order" ? `Message about ORD-${room.order?.no ?? ""}` : `Message #${room.title}`}
            onTyping={() => rt.current?.send({ type: "broadcast", event: "typing", payload: { id: me.id, name: meStaff?.first ?? me.name } })}
            onSent={async () => { await refreshRef.current(); setMember(true); toBottom(true); }}
          />
        ) : (
          <div className="chat-joinbar"><span className="small muted">This channel is archived. Its messages stay here to look back on.</span></div>
        )}
      </div>

      {thread ? (
        <aside className="chat-thread">
          <header className="chat-head">
            <b className="grow">Thread</b>
            <button type="button" className="iconbtn" aria-label="Close thread" onClick={() => setThread(null)}><X size={18} /></button>
          </header>
          <div className="chat-scroll">
            {threadMsgs.map((m, i) => (
              <div key={m.id}>
                <Message
                  m={m} me={me} staff={staff} grouped={false} flash={false} isAdmin={isAdmin} inThread
                  onThread={() => {}}
                  onReact={(e) => act("react", () => chatReact(m.id, e))}
                  onPin={() => act("pin", () => chatPin(m.id, !m.pinned_at))}
                  onEdit={(t) => act("edit", () => chatEdit(m.id, t))}
                  onDelete={() => act("delete", () => chatDelete(m.id))}
                  onTodo={() => act("todo", () => todoAdd((m.body || "Follow up").slice(0, 200), null, m.id))}
                />
                {i === 0 ? <div className="chat-day"><span>{threadMsgs.length - 1} {threadMsgs.length === 2 ? "reply" : "replies"}</span></div> : null}
              </div>
            ))}
          </div>
          {canPost ? (
            <Composer
              roomId={room.id} me={me} staff={staff} members={room.kind === "channel" && !room.private ? null : members} aiReady={aiReady} parent={thread}
              placeholder="Reply in the thread"
              onTyping={() => {}}
              onSent={async () => { setThreadMsgs(await chatThread(thread)); await refreshRef.current(); }}
            />
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ one message

function Message({
  m, me, staff, grouped, flash, isAdmin, inThread = false, onThread, onReact, onPin, onEdit, onDelete, onTodo,
}: {
  m: ChatMsg; me: { id: string }; staff: Staff[]; grouped: boolean; flash: boolean; isAdmin: boolean; inThread?: boolean;
  onThread: () => void; onReact: (e: string) => void; onPin: () => void; onEdit: (t: string) => void; onDelete: () => void; onTodo: () => void;
}) {
  const [menu, setMenu] = useState<null | "more" | "react">(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const mine = m.user_id === me.id;
  if (m.kind === "system") return <div className="chat-sys tiny muted">{m.body} · {time(m.created_at)}</div>;
  const mentioned = m.mentions.includes(me.id);
  return (
    <div id={`m-${m.id}`} className={`chat-msg${grouped ? " grouped" : ""}${flash ? " flash" : ""}${mentioned ? " mentioned" : ""}${m.pinned_at ? " pinned" : ""}`} onMouseLeave={() => (setMenu(null), setSure(false))}>
      <div className="chat-av" style={{ background: m.kind === "ai" ? "var(--red)" : tone(m.user_id) }} aria-hidden>
        {grouped ? null : m.kind === "ai" ? <Sparkles size={15} /> : initials(m.by)}
      </div>
      <div className="chat-bubble">
        {grouped ? null : (
          <div className="chat-meta">
            <b>{m.by}</b>
            <span className="tiny faint">{time(m.created_at)}</span>
            {m.pinned_at ? <span className="tiny chat-pinned"><Pin size={11} /> pinned{m.pinned_by_name ? ` by ${m.pinned_by_name.split(" ")[0]}` : ""}</span> : null}
          </div>
        )}
        {m.deleted_at ? (
          <div className="chat-text faint"><i>Message deleted</i></div>
        ) : editing !== null ? (
          <div className="col" style={{ gap: 6 }}>
            <textarea className="textarea" rows={2} value={editing} onChange={(e) => setEditing(e.target.value)} autoFocus />
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm" onClick={() => (onEdit(editing), setEditing(null))}><Check size={14} /> Save</button>
              <button type="button" className="btn sm dark" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {m.body ? <div className="chat-text"><Body text={m.body} staff={staff} me={me.id} />{m.edited_at ? <span className="tiny faint"> (edited)</span> : null}</div> : null}
            {m.files.length ? (
              <div className="chat-files">
                {m.files.map((f) =>
                  isImg(f) && f.url ? (
                    <a key={f.path} href={f.url} target="_blank" rel="noopener noreferrer" className="chat-img"><img src={f.url} alt={f.name} loading="lazy" /></a>
                  ) : (
                    <a key={f.path} href={f.url ?? "#"} target="_blank" rel="noopener noreferrer" className="chat-file"><FileText size={16} /> <span className="ellipsis">{f.name}</span> <span className="tiny faint">{kb(f.size)}</span></a>
                  ),
                )}
              </div>
            ) : null}
          </>
        )}
        {m.reactions.length ? (
          <div className="chat-reacts">
            {m.reactions.map((r) => (
              <button key={r.emoji} type="button" className={`chat-react${r.mine ? " mine" : ""}`} title={r.who.join(", ")} onClick={() => onReact(r.emoji)}>{r.emoji} {r.n}</button>
            ))}
          </div>
        ) : null}
        {!inThread && m.reply_count > 0 ? (
          <button type="button" className="chat-replies" onClick={onThread}>
            <MessageSquareReply size={14} /> {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
            {m.last_reply_at ? <span className="tiny faint"> · last {time(m.last_reply_at)}</span> : null}
          </button>
        ) : null}
      </div>
      {m.deleted_at || editing !== null ? null : (
        <div className={`chat-tools${menu ? " open" : ""}`}>
          <button type="button" className="iconbtn sm" aria-label="React" onClick={() => setMenu(menu === "react" ? null : "react")}><SmilePlus size={15} /></button>
          {inThread ? null : <button type="button" className="iconbtn sm" aria-label="Reply in thread" onClick={onThread}><MessageSquareReply size={15} /></button>}
          <button type="button" className="iconbtn sm" aria-label="More" onClick={() => setMenu(menu === "more" ? null : "more")}><MoreHorizontal size={15} /></button>
          {menu === "react" ? (
            <div className="chat-menu chat-emoji">
              {QUICK.map((e) => <button key={e} type="button" onClick={() => (onReact(e), setMenu(null))}>{e}</button>)}
            </div>
          ) : null}
          {menu === "more" ? (
            <div className="chat-menu">
              <button type="button" onClick={() => (onTodo(), setMenu(null))}><ListTodo size={15} /> Add to my to-dos</button>
              <button type="button" onClick={() => (onPin(), setMenu(null))}>{m.pinned_at ? <PinOff size={15} /> : <Pin size={15} />} {m.pinned_at ? "Unpin" : "Pin"}</button>
              <button type="button" onClick={() => (navigator.clipboard?.writeText(m.body), setMenu(null))}><Copy size={15} /> Copy text</button>
              <button type="button" onClick={() => (navigator.clipboard?.writeText(`${location.origin}/chat/${m.channel_id}?m=${m.id}`), setMenu(null))}><Copy size={15} /> Copy link</button>
              {mine ? <button type="button" onClick={() => (setEditing(m.body), setMenu(null))}><Pencil size={15} /> Edit</button> : null}
              {mine || isAdmin ? (
                <button type="button" className="danger" onClick={() => (sure ? (onDelete(), setMenu(null), setSure(false)) : setSure(true))}><Trash2 size={15} /> {sure ? "Yes, delete it" : "Delete"}</button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the box at the bottom

function Composer({
  roomId, me, staff, members, aiReady, parent, placeholder, onTyping, onSent,
}: {
  roomId: string; me: { id: string; name: string }; staff: Staff[]; members: string[] | null; aiReady: boolean; parent: number | null;
  placeholder: string; onTyping: () => void; onSent: () => Promise<void>;
}) {
  const key = `chat-draft:${roomId}:${parent ?? ""}`;
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [files, setFiles] = useState<{ path: string; name: string; type: string; size: number; preview: string | null }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [at, setAt] = useState<{ q: string; start: number } | null>(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState<null | "send" | "ai">(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const base = useRef("");
  const caretAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretAt.current === null) return;
    box.current?.focus();
    box.current?.setSelectionRange(caretAt.current, caretAt.current);
    caretAt.current = null;
  }, [text]);
  const sb = useMemo(() => createClient(), []);
  const [micOk, setMicOk] = useState(false);
  useEffect(() => setMicOk(canListen()), []);
  // Keep an unsent draft per conversation on this device.
  useEffect(() => {
    try {
      const d = localStorage.getItem(key);
      if (d) setText(d);
    } catch {}
  }, [key]);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(key, text);
      else localStorage.removeItem(key);
    } catch {}
  }, [text, key]);

  const listen = useListen({
    onText: (t) => setText(`${base.current}${base.current && t ? " " : ""}${t}`),
    onDone: (t) => setText(`${base.current}${base.current && t ? " " : ""}${t}`.trim()),
    onError: (m) => setErr(m),
  });

  const pool = useMemo(() => staff.filter((s) => s.id !== me.id && (!members || members.includes(s.id))), [staff, members, me.id]);
  const hits = useMemo(() => {
    if (!at) return [];
    const q = at.q.toLowerCase();
    return pool.filter((s) => s.name.toLowerCase().includes(q) || s.first.toLowerCase().startsWith(q)).slice(0, 6);
  }, [at, pool]);

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  useEffect(grow, [text]);

  const onChange = (v: string) => {
    setText(v);
    const el = box.current;
    const caret = el?.selectionStart ?? v.length;
    const m = /(^|\s)@([A-Za-z'.-]{0,24})$/.exec(v.slice(0, caret));
    setAt(m ? { q: m[2], start: caret - m[2].length - 1 } : null);
    setPick(0);
    if (Date.now() - lastTyping.current > 2500) {
      lastTyping.current = Date.now();
      onTyping();
    }
  };
  const choose = (s: Staff) => {
    if (!at) return;
    const el = box.current;
    const caret = el?.selectionStart ?? text.length;
    const v = `${text.slice(0, at.start)}@${s.name} ${text.slice(caret)}`;
    caretAt.current = at.start + s.name.length + 2;
    setText(v);
    setMentions((m) => [...new Set([...m, s.id])]);
    setAt(null);
  };
  /** Anyone written as @Full Name (typed, said into the mic or written by AMBIT) counts as mentioned. */
  const mentionIds = (t: string) => [...new Set([...mentions, ...pool.filter((s) => t.includes(`@${s.name}`)).map((s) => s.id)])].filter((id) => t.includes(`@${pool.find((s) => s.id === id)?.name}`));

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr(null);
    for (const f of Array.from(list).slice(0, 10)) {
      if (f.size > 50 * 1048576) {
        setErr(`${f.name} is over 50 MB.`);
        continue;
      }
      setUploading((n) => n + 1);
      const safe = f.name.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-80) || "file";
      const path = `${roomId}/${crypto.randomUUID()}/${safe}`;
      const up = await sb.storage.from("chat-files").upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
      setUploading((n) => n - 1);
      if (up.error) {
        setErr(`${f.name}: ${up.error.message}`);
        continue;
      }
      setFiles((fs) => [...fs, { path, name: f.name, type: f.type || "application/octet-stream", size: f.size, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null }]);
    }
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !files.length) || uploading || busy) return;
    setBusy("send");
    setErr(null);
    const r = await chatPost({ channel: roomId, body, parent, files: files.map(({ preview: _p, ...f }) => f), mentions: mentionIds(body) }); // eslint-disable-line @typescript-eslint/no-unused-vars
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setText("");
    setFiles([]);
    setMentions([]);
    await onSent();
  };

  const draft = async () => {
    setBusy("ai");
    setErr(null);
    const r = await chatDraft(roomId, text, parent);
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setText(r.text);
    requestAnimationFrame(() => box.current?.focus());
  };

  return (
    <div className="chat-compose">
      {files.length || uploading ? (
        <div className="chat-up">
          {files.map((f) => (
            <span key={f.path} className="chat-up-chip">
              {f.preview ? <img src={f.preview} alt="" /> : <FileText size={14} />}
              <span className="ellipsis tiny">{f.name}</span>
              <button type="button" className="iconbtn sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.path !== f.path))}><X size={13} /></button>
            </span>
          ))}
          {uploading ? <span className="chat-up-chip"><LoaderCircle size={14} className="spin" /> <span className="tiny">Uploading…</span></span> : null}
        </div>
      ) : null}
      {at && hits.length ? (
        <div className="chat-at-menu" role="listbox">
          {hits.map((s, i) => (
            <button key={s.id} type="button" role="option" aria-selected={i === pick} className={i === pick ? "on" : ""} onMouseDown={(e) => (e.preventDefault(), choose(s))}>
              <span className="chat-av sm" style={{ background: tone(s.id) }}>{initials(s.name)}</span> {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {err ? <div className="tiny" style={{ color: "var(--err-text)", padding: "0 4px" }}>{err}</div> : null}
      <div className={`chat-box${listen.listening ? " listening" : ""}`}>
        <button type="button" className="iconbtn" aria-label="Attach a photo or file" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ""))} />
        <textarea
          ref={box}
          rows={1}
          className="chat-input"
          value={text}
          placeholder={listen.listening ? "Listening… say what you want to send" : placeholder}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              upload(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (at && hits.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setPick((p) => (p + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
            } else if (at && hits.length && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              choose(hits[pick]);
            } else if (e.key === "Escape") setAt(null);
            else if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
              e.preventDefault();
              send();
            }
          }}
        />
        {micOk ? (
          <button
            type="button"
            className={`iconbtn chat-mic${listen.listening ? " on" : ""}`}
            aria-label={listen.listening ? "Stop listening" : "Talk instead of typing"}
            onClick={() => {
              if (listen.listening) return listen.stop();
              base.current = text.trim();
              setErr(null);
              listen.start();
            }}
          >
            {listen.listening ? <Square size={15} /> : <Mic size={18} />}
          </button>
        ) : null}
        {aiReady ? (
          <button type="button" className="iconbtn chat-spark" aria-label={text.trim() ? "Let AMBIT Intelligence write it from what you said" : "Suggest a reply"} title={text.trim() ? "Turn what you said into a clear message" : "Suggest a reply"} onClick={draft} disabled={busy === "ai"}>
            {busy === "ai" ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
          </button>
        ) : null}
        <button type="button" className="chat-send" aria-label="Send" onClick={send} disabled={busy === "send" || uploading > 0 || (!text.trim() && !files.length)}>
          {busy === "send" ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}
        </button>
      </div>
      <div className="chat-hint tiny faint">
        <span>@ to mention someone (it goes on their to-do list)</span>
        {micOk ? <span> · <Mic size={11} /> talk, then <Sparkles size={11} /> to tidy it up</span> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ settings

function RoomSettings({
  room, isAdmin, member, notify, staff, members, onNotify, onJoin, onMembers, onSave,
}: {
  room: RoomInfo; isAdmin: boolean; member: boolean; notify: "all" | "mentions" | "none"; staff: Staff[]; members: string[];
  onNotify: (m: "all" | "mentions" | "none") => void; onJoin: (j: boolean) => void; onMembers: (add: string[], remove: string[]) => void;
  onSave: (d: { name?: string; about?: string; private?: boolean; archive?: boolean }) => void;
}) {
  const [name, setName] = useState(room.title);
  const [about, setAbout] = useState(room.about ?? "");
  const [add, setAdd] = useState("");
  const canPeople = (room.kind === "channel" && isAdmin) || room.kind === "dm";
  const others = staff.filter((s) => !members.includes(s.id));
  return (
    <div className="chat-panel col" style={{ gap: 14 }}>
      {member ? (
        <div className="field">
          <span className="label">Notify me</span>
          <div className="seg">
            <button type="button" className={notify === "all" ? "on" : ""} onClick={() => onNotify("all")}><Bell size={14} /> Every message</button>
            <button type="button" className={notify === "mentions" ? "on" : ""} onClick={() => onNotify("mentions")}>@Mentions</button>
            <button type="button" className={notify === "none" ? "on" : ""} onClick={() => onNotify("none")}><BellOff size={14} /> Mute</button>
          </div>
        </div>
      ) : null}
      <div className="field">
        <span className="label">People ({members.length})</span>
        <div className="chat-people">
          {members.map((id) => {
            const s = staff.find((x) => x.id === id);
            return (
              <span key={id} className="chat-person">
                <span className="chat-av sm" style={{ background: tone(id) }}>{initials(s?.name ?? "?")}</span> {s?.name ?? "Former employee"}
                {canPeople && isAdmin && room.kind === "channel" ? <button type="button" className="iconbtn sm" aria-label={`Take ${s?.name} off`} onClick={() => onMembers([], [id])}><X size={12} /></button> : null}
              </span>
            );
          })}
        </div>
        {canPeople ? (
          <div className="row" style={{ gap: 8 }}>
            <select className="select sm grow" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Add someone">
              <option value="">Add someone…</option>
              {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="btn sm" disabled={!add} onClick={() => (onMembers([add], []), setAdd(""))}>Add</button>
          </div>
        ) : null}
      </div>
      {room.kind === "channel" && isAdmin ? (
        <div className="field">
          <span className="label">Channel (admins)</span>
          <input className="input sm" value={name} onChange={(e) => setName(e.target.value)} aria-label="Channel name" />
          <input className="input sm" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What it's for" aria-label="What it's for" />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn sm" onClick={() => onSave({ name, about })}>Save</button>
            <button type="button" className="btn sm dark" onClick={() => onSave({ private: !room.private })}>{room.private ? "Make it open to everyone" : "Make it private"}</button>
            <button type="button" className="btn sm dark" onClick={() => onSave({ archive: !room.archived })}>{room.archived ? "Bring it back" : "Archive"}</button>
          </div>
        </div>
      ) : null}
      {member && room.kind !== "dm" ? <button type="button" className="btn sm dark" style={{ alignSelf: "flex-start" }} onClick={() => onJoin(false)}>Leave</button> : null}
    </div>
  );
}
