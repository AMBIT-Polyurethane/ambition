import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Team Chat (0063): the shapes the screens use, and reading conversations with the person's own login (the
// database decides what they can see).

export type Staff = { id: string; name: string; first: string; role: string | null; branch: string | null };
export type ChatFile = { path: string; name: string; type: string; size: number; url?: string | null };
export type Reaction = { emoji: string; n: number; mine: boolean; who: string[] };
export type ChatMsg = {
  id: number;
  channel_id: string;
  user_id: string | null;
  by: string;
  parent_id: number | null;
  body: string;
  mentions: string[];
  files: ChatFile[];
  kind: "text" | "system" | "ai";
  reply_count: number;
  last_reply_at: string | null;
  pinned_at: string | null;
  pinned_by_name: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  reactions: Reaction[];
};
export type ChannelRow = {
  id: string;
  kind: "channel" | "dm" | "order";
  name: string;
  about: string | null;
  private: boolean;
  order_id: string | null;
  last_message_at: string | null;
  archived: boolean;
  member: boolean;
  notify: "all" | "mentions" | "none";
  unread: number;
  mentions: number;
  people: string | null;
  preview: string | null;
  preview_by: string | null;
};

const MSG_COLS = "id, channel_id, user_id, parent_id, body, mentions, files, kind, reply_count, last_reply_at, pinned_at, pinned_by_name, edited_at, deleted_at, created_at";

/** Everyone at AMBIT who can chat (for @mentions and starting a direct message). */
export async function staffList(db: SupabaseClient): Promise<Staff[]> {
  const { data } = await db
    .from("profiles")
    .select("id, full_name, email, job_role, branch_id")
    .in("role", ["employee", "admin"])
    .eq("status", "active")
    .eq("demo", false)
    .order("full_name");
  return ((data ?? []) as { id: string; full_name: string | null; email: string; job_role: string | null; branch_id: string | null }[]).map((p) => {
    const name = (p.full_name || p.email.split("@")[0]).trim();
    return { id: p.id, name, first: name.split(/\s+/)[0], role: p.job_role, branch: p.branch_id };
  });
}

/** A conversation's title as people see it. */
export const channelTitle = (c: Pick<ChannelRow, "kind" | "name" | "people">) => (c.kind === "dm" ? c.people || "Just you" : c.name);

/** Messages with who wrote them, reactions and links to their files. */
export async function withExtras(db: SupabaseClient, rows: Omit<ChatMsg, "by" | "reactions">[], me: string, names: Map<string, string>): Promise<ChatMsg[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const paths = rows.flatMap((r) => (Array.isArray(r.files) ? r.files.map((f) => f.path) : []));
  const [{ data: rx }, signed] = await Promise.all([
    db.from("chat_reactions").select("message_id, user_id, emoji, created_at").in("message_id", ids).order("created_at"),
    paths.length ? db.storage.from("chat-files").createSignedUrls(paths, 60 * 60 * 6) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);
  const url = new Map(((signed.data ?? []) as { path: string | null; signedUrl: string }[]).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
  const by = new Map<number, Reaction[]>();
  for (const r of (rx ?? []) as { message_id: number; user_id: string; emoji: string }[]) {
    const list = by.get(r.message_id) ?? [];
    let e = list.find((x) => x.emoji === r.emoji);
    if (!e) list.push((e = { emoji: r.emoji, n: 0, mine: false, who: [] }));
    e.n++;
    if (r.user_id === me) e.mine = true;
    e.who.push(names.get(r.user_id) ?? "Someone");
    by.set(r.message_id, list);
  }
  return rows.map((r) => ({
    ...r,
    files: (Array.isArray(r.files) ? r.files : []).map((f) => ({ ...f, url: url.get(f.path) ?? null })),
    by: r.kind === "system" ? "AMBIT" : r.kind === "ai" ? "AMBIT Intelligence" : (r.user_id && names.get(r.user_id)) || "Former employee",
    reactions: by.get(r.id) ?? [],
  }));
}

/** The latest messages in a conversation (top level), oldest first. before: older than that id. */
export async function loadMessages(db: SupabaseClient, channel: string, me: string, names: Map<string, string>, opts: { before?: number; from?: number; limit?: number } = {}) {
  let q = db.from("chat_messages").select(MSG_COLS).eq("channel_id", channel).is("parent_id", null).order("id", { ascending: false }).limit(opts.limit ?? 60);
  if (opts.before) q = q.lt("id", opts.before);
  if (opts.from) q = q.gte("id", opts.from);
  const { data } = await q;
  const rows = ((data ?? []) as Omit<ChatMsg, "by" | "reactions">[]).reverse();
  return withExtras(db, rows, me, names);
}

/** A thread: the message and its replies. */
export async function loadThread(db: SupabaseClient, parent: number, me: string, names: Map<string, string>) {
  const { data } = await db.from("chat_messages").select(MSG_COLS).or(`id.eq.${parent},parent_id.eq.${parent}`).order("id").limit(300);
  return withExtras(db, (data ?? []) as Omit<ChatMsg, "by" | "reactions">[], me, names);
}

/** The list of conversations (with unread counts). Empty until migration 0063 is run. */
export async function overview(db: SupabaseClient): Promise<{ rows: ChannelRow[]; ready: boolean }> {
  const { data, error } = await db.rpc("chat_overview");
  if (error) return { rows: [], ready: !/chat_overview|function|schema cache/i.test(error.message) };
  return { rows: (data ?? []) as ChannelRow[], ready: true };
}

/** The badge number (0 before 0063). */
export async function unreadTotal(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("chat_unread_total");
  return error ? 0 : Number(data ?? 0);
}

export type Todo = { id: number; text: string; due_on: string | null; channel_id: string | null; message_id: number | null; from_name: string | null; source: string; done_at: string | null; created_at: string };
export async function myTodos(db: SupabaseClient, uid: string, opts: { done?: boolean; limit?: number } = {}): Promise<Todo[]> {
  let q = db.from("chat_todos").select("id, text, due_on, channel_id, message_id, from_name, source, done_at, created_at").eq("user_id", uid);
  q = opts.done ? q.not("done_at", "is", null).order("done_at", { ascending: false }) : q.is("done_at", null).order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  const { data, error } = await q.limit(opts.limit ?? 50);
  return error ? [] : ((data ?? []) as Todo[]);
}

/** Text with @mentions written as @[Name](id) in the box turned into plain "@Name" plus the ids. */
export function readMentions(body: string, staff: Staff[]): { text: string; ids: string[] } {
  const ids = new Set<string>();
  const text = body.replace(/@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/g, (_, name: string, id: string) => {
    if (staff.some((s) => s.id === id)) ids.add(id);
    return `@${name}`;
  });
  return { text, ids: [...ids] };
}

/** Order boards for a list of orders: how many messages each has (0 when there's no board yet). */
export async function orderBoardCounts(db: SupabaseClient, orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!orderIds.length) return out;
  const { data: chans, error } = await db.from("chat_channels").select("id, order_id").in("order_id", orderIds.slice(0, 300));
  if (error || !chans?.length) return out;
  const byChan = new Map((chans as { id: string; order_id: string }[]).map((c) => [c.id, c.order_id]));
  const { data: msgs } = await db.from("chat_messages").select("channel_id").in("channel_id", [...byChan.keys()]).is("deleted_at", null).neq("kind", "system").limit(10000);
  for (const m of (msgs ?? []) as { channel_id: string }[]) {
    const o = byChan.get(m.channel_id);
    if (o) out.set(o, (out.get(o) ?? 0) + 1);
  }
  return out;
}
