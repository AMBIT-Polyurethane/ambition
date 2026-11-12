"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireEmployee } from "@/lib/session";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { claudeReady, fillForm, friendlyClaudeError } from "@/lib/ai/claude";
import { todayCentral } from "@/lib/sale";
import { sendPush } from "@/lib/push";
import { loadMessages, loadThread, staffList, type ChatMsg } from "@/lib/chat";

// Team Chat (0063). Everything goes through the database's chat_* functions with the person's own login, so the
// database decides who can see and post where. Notifications and AI to-dos run after the answer goes back.

const AI_MODEL = "claude-haiku-5-5";
type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: { message: string } | null | undefined, fallback = "Something went wrong."): { ok: false; error: string } => ({ ok: false, error: e?.message ?? fallback });
const names = async (db: Parameters<typeof staffList>[0]) => new Map((await staffList(db)).map((s) => [s.id, s.name]));

// ------------------------------------------------------------------ reading

/** The latest messages (or older ones before an id), with reactions and file links. */
export async function chatMessages(channel: string, opts: { before?: number; from?: number } = {}): Promise<ChatMsg[]> {
  const { supabase, profile } = await requireEmployee();
  return loadMessages(supabase, channel, profile.id, await names(supabase), opts);
}

export async function chatThread(parent: number): Promise<ChatMsg[]> {
  const { supabase, profile } = await requireEmployee();
  return loadThread(supabase, parent, profile.id, await names(supabase));
}

export async function chatRead(channel: string, upto: number): Promise<void> {
  const { supabase } = await requireEmployee();
  await supabase.rpc("chat_read", { p_channel: channel, p_upto: upto });
}

// ------------------------------------------------------------------ posting

export type PostInput = { channel: string; body: string; parent?: number | null; files?: { path: string; name: string; type: string; size: number }[]; mentions?: string[]; ai?: boolean };

export async function chatPost(d: PostInput): Promise<R<{ id: number }>> {
  const { supabase, profile } = await requireEmployee();
  const body = String(d.body ?? "").slice(0, 8000);
  const staff = await staffList(supabase);
  // Only people whose @Name is still in the message.
  const mentions = [...new Set(d.mentions ?? [])].filter((id) => {
    const s = staff.find((x) => x.id === id);
    return s && id !== profile.id && body.includes(`@${s.name}`);
  });
  const files = (d.files ?? []).slice(0, 10).map((f) => ({ path: String(f.path), name: String(f.name).slice(0, 120), type: String(f.type).slice(0, 80), size: Number(f.size) || 0 }));
  const { data, error } = await supabase.rpc("chat_post", { p_channel: d.channel, p_body: body, p_parent: d.parent ?? null, p_files: files, p_mentions: mentions, p_kind: d.ai ? "ai" : "text" });
  if (error) return fail(error);
  const id = Number(data);

  // A to-do for everyone @mentioned (the words of the message for now; AMBIT Intelligence tidies them up below).
  if (mentions.length) {
    const plain = body.replace(/@([A-Z][\w'.-]*(?:\s[A-Z][\w'.-]*)?)/g, "").replace(/\s+/g, " ").trim();
    await supabase.rpc("chat_add_todos", {
      p_message: id,
      p_items: mentions.map((u) => ({ user_id: u, text: (plain || body).slice(0, 200) })),
    });
  }

  const me = profile.full_name || profile.email;
  after(async () => {
    if (!serviceReady()) return;
    const db = serviceClient();
    if (mentions.length && claudeReady()) await tidyTodos(db, id, body, me, mentions.map((m) => staff.find((s) => s.id === m)!).filter(Boolean)).catch(() => null);
    await notify(db, d.channel, id, profile.id, me, body, files.length, mentions, d.parent ?? null).catch(() => null);
  });
  return { ok: true, id };
}

/** Turns "@Tyler can you load the Red River order by 2pm?" into Tyler's to-do: "Load the Red River order (by 2pm today)". */
async function tidyTodos(db: ReturnType<typeof serviceClient>, message: number, body: string, from: string, people: { id: string; name: string }[]) {
  const { data } = await fillForm<{ todos: { name: string; todo: string; due_on: string; needed: boolean }[] }>({
    model: AI_MODEL,
    maxTokens: 600,
    system: `You turn a team chat message at AMBIT Polyurethane (spray foam and insulation supply) into a short to-do for each person @mentioned in it. Today is ${todayCentral()} (America/Chicago). Write each to-do as a plain imperative under 90 characters, starting with a verb ("Load the Red River order", "Call Hughes Insulation about the drums"), keeping order numbers, customers and times. due_on: YYYY-MM-DD only when the message gives a day or "today"/"tomorrow", else empty. needed: false when the message asks that person for nothing (a thank-you, an FYI).`,
    content: `Message from ${from}:\n${body}\n\nPeople @mentioned: ${people.map((p) => p.name).join(", ")}`,
    name: "todos",
    description: "One to-do per person mentioned.",
    schema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, todo: { type: "string" }, due_on: { type: "string" }, needed: { type: "boolean" } }, required: ["name", "todo", "due_on", "needed"] },
        },
      },
      required: ["todos"],
    },
  });
  for (const p of people) {
    const t = data.todos.find((x) => x.name.toLowerCase() === p.name.toLowerCase()) ?? data.todos.find((x) => p.name.toLowerCase().startsWith(x.name.toLowerCase().split(" ")[0]));
    if (!t) continue;
    if (t.needed === false) {
      await db.from("chat_todos").delete().eq("message_id", message).eq("user_id", p.id).is("done_at", null);
      continue;
    }
    const due = /^\d{4}-\d{2}-\d{2}$/.test(t.due_on ?? "") ? t.due_on : null;
    await db.from("chat_todos").update({ text: t.todo.slice(0, 300), due_on: due, source: "ai" }).eq("message_id", message).eq("user_id", p.id);
  }
}

/** Phone notifications: direct messages, @mentions, and conversations people chose to hear everything from. */
async function notify(db: ReturnType<typeof serviceClient>, channel: string, msg: number, author: string, authorName: string, body: string, nFiles: number, mentions: string[], parent: number | null) {
  const [{ data: c }, { data: members }] = await Promise.all([
    db.from("chat_channels").select("kind, name").eq("id", channel).maybeSingle(),
    db.from("chat_members").select("user_id, notify").eq("channel_id", channel),
  ]);
  if (!c) return;
  const list = (members ?? []) as { user_id: string; notify: string }[];
  const hear = new Set<string>();
  for (const m of list) {
    if (m.user_id === author || m.notify === "none") continue;
    if (c.kind === "dm" || m.notify === "all" || mentions.includes(m.user_id)) hear.add(m.user_id);
  }
  // A reply in a thread: everyone who wrote in that thread too.
  if (parent) {
    const { data: t } = await db.from("chat_messages").select("user_id").or(`id.eq.${parent},parent_id.eq.${parent}`);
    for (const r of (t ?? []) as { user_id: string | null }[]) if (r.user_id && r.user_id !== author && list.find((m) => m.user_id === r.user_id)?.notify !== "none") hear.add(r.user_id);
  }
  if (!hear.size) return;
  const where = c.kind === "dm" ? "" : c.kind === "channel" ? ` in #${c.name}` : ` on ${String(c.name).split(" · ")[0]}`;
  const text = body.trim() || (nFiles ? "Sent a photo or file" : "");
  for (const uid of hear) {
    const mentioned = mentions.includes(uid);
    await sendPush([uid], {
      title: `${authorName}${mentioned ? " mentioned you" : ""}${where}`,
      body: text,
      url: `/chat/${channel}?m=${msg}${parent ? `&t=${parent}` : ""}`,
      tag: `chat-${channel}`,
    });
  }
}

export async function chatEdit(id: number, body: string): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_edit", { p_id: id, p_body: body });
  return error ? fail(error) : { ok: true };
}
export async function chatDelete(id: number): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_delete", { p_id: id });
  return error ? fail(error) : { ok: true };
}
export async function chatPin(id: number, on: boolean): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_pin", { p_id: id, p_on: on });
  return error ? fail(error) : { ok: true };
}
export async function chatReact(id: number, emoji: string): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_react", { p_id: id, p_emoji: emoji });
  return error ? fail(error) : { ok: true };
}
export async function chatNotify(channel: string, mode: "all" | "mentions" | "none"): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_set_notify", { p_channel: channel, p_mode: mode });
  revalidatePath("/chat", "layout");
  return error ? fail(error) : { ok: true };
}
export async function chatJoin(channel: string, join: boolean): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_join", { p_channel: channel, p_join: join });
  revalidatePath("/chat", "layout");
  return error ? fail(error) : { ok: true };
}

/** Deletes a direct message for you (0064): it comes back, with only new messages, when someone sends one. */
export async function chatHide(channel: string): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_hide", { p_channel: channel });
  revalidatePath("/chat", "layout");
  if (error && /chat_hide|function|schema cache/i.test(error.message)) return { ok: false, error: "Deleting a chat needs the 0064 database update first. Ask Jeremiah to run it." };
  return error ? fail(error) : { ok: true };
}

/** Admins: bring back a deleted direct message (history included) for that person. */
export async function chatRestore(form: FormData) {
  const { supabase } = await requireAdmin();
  const channel = String(form.get("channel") ?? "");
  const user = String(form.get("user") ?? "");
  const { error } = await supabase.rpc("chat_restore", { p_channel: channel, p_user: user });
  revalidatePath("/chat", "layout");
  redirect(`/chat/deleted?${error ? `err=${encodeURIComponent(error.message)}` : "msg=Restored."}`);
}

// ------------------------------------------------------------------ making conversations

export async function chatStartDm(users: string[]): Promise<R<{ id: string }>> {
  const { supabase } = await requireEmployee();
  const { data, error } = await supabase.rpc("chat_dm", { p_users: users });
  return error ? fail(error) : { ok: true, id: String(data) };
}

export async function chatCreateChannel(d: { name: string; about: string; private: boolean; members: string[] }): Promise<R<{ id: string }>> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("chat_create_channel", { p_name: d.name, p_about: d.about, p_private: d.private, p_members: d.members });
  revalidatePath("/chat", "layout");
  return error ? fail(error) : { ok: true, id: String(data) };
}

export async function chatUpdateChannel(id: string, d: { name?: string; about?: string; private?: boolean; archive?: boolean }): Promise<R> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("chat_update_channel", { p_id: id, p_name: d.name ?? null, p_about: d.about ?? null, p_private: d.private ?? null, p_archive: d.archive ?? null });
  revalidatePath("/chat", "layout");
  return error ? fail(error) : { ok: true };
}

export async function chatSetMembers(id: string, add: string[], remove: string[]): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.rpc("chat_set_members", { p_id: id, p_add: add, p_remove: remove });
  revalidatePath("/chat", "layout");
  return error ? fail(error) : { ok: true };
}

/** The order's conversation board (made the first time), then open it. */
export async function openOrderBoard(form: FormData) {
  const { supabase } = await requireEmployee();
  const order = String(form.get("order") ?? "");
  const { data, error } = await supabase.rpc("chat_order", { p_order: order });
  if (error || !data) redirect(`/orders/${order}?err=${encodeURIComponent(error?.message ?? "Couldn't open the order's chat.")}`);
  redirect(`/chat/${data}`);
}

// ------------------------------------------------------------------ to-dos

export async function todoDone(id: number, done: boolean): Promise<R> {
  const { supabase } = await requireEmployee();
  const { error } = await supabase.from("chat_todos").update({ done_at: done ? new Date().toISOString() : null }).eq("id", id);
  revalidatePath("/");
  revalidatePath("/chat/todos");
  return error ? fail(error) : { ok: true };
}

export async function todoAdd(text: string, due: string | null, message: number | null): Promise<R<{ id: number }>> {
  const { supabase } = await requireEmployee();
  const { data, error } = await supabase.rpc("chat_todo_add", { p_text: text, p_due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, p_message: message });
  revalidatePath("/");
  revalidatePath("/chat/todos");
  return error ? fail(error) : { ok: true, id: Number(data) };
}

// ------------------------------------------------------------------ AMBIT Intelligence in chat

type Hit = { id: number; channel_id: string; channel: string; kind: string; parent_id: number | null; body: string; created_at: string; by_name: string };

export async function chatSearch(q: string): Promise<Hit[]> {
  const { supabase } = await requireEmployee();
  const term = String(q ?? "").trim().slice(0, 120);
  if (!term) return [];
  const { data } = await supabase.rpc("chat_search", { p_q: term, p_limit: 40 });
  return (data ?? []) as Hit[];
}

/** "Where did Kim say the Covestro truck was coming?": searches chat and answers, pointing at the messages. */
export async function chatAsk(question: string): Promise<R<{ answer: string; refs: Hit[] }>> {
  const { supabase } = await requireEmployee();
  const qn = String(question ?? "").trim().slice(0, 400);
  if (!qn) return { ok: false, error: "Ask a question." };
  // Search on the question's words, any of them (and the whole question).
  const words = qn.toLowerCase().replace(/[^a-z0-9#\- ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const seen = new Map<number, Hit>();
  for (const term of [qn, words.join(" or ")].filter(Boolean)) {
    const { data } = await supabase.rpc("chat_search", { p_q: term, p_limit: 40 });
    for (const h of (data ?? []) as Hit[]) seen.set(h.id, h);
  }
  const hits = [...seen.values()].slice(0, 40);
  if (!hits.length) return { ok: true, answer: "I couldn't find anything in chat about that. Try other words (a customer, an order number, a product).", refs: [] };
  if (!claudeReady()) return { ok: true, answer: `Found ${hits.length} message${hits.length === 1 ? "" : "s"}:`, refs: hits.slice(0, 8) };
  try {
    const { data } = await fillForm<{ answer: string; ids: number[] }>({
      model: AI_MODEL,
      maxTokens: 700,
      system: `You answer questions about AMBIT Polyurethane's team chat using only the messages given. Be short and plain (2-4 sentences). Say who said it and when. If the messages don't answer it, say so. ids: the messages that answer it, most useful first (at most 6). Today is ${todayCentral()}.`,
      content: `Question: ${qn}\n\nMessages:\n${hits.map((h) => `[${h.id}] ${h.created_at.slice(0, 16).replace("T", " ")} · ${h.channel} · ${h.by_name}: ${h.body}`).join("\n")}`,
      name: "answer",
      description: "The answer and the messages it comes from.",
      schema: { type: "object", properties: { answer: { type: "string" }, ids: { type: "array", items: { type: "number" } } }, required: ["answer", "ids"] },
    });
    const refs = data.ids.map((i) => seen.get(Number(i))).filter((h): h is Hit => Boolean(h)).slice(0, 6);
    return { ok: true, answer: data.answer, refs };
  } catch (e) {
    return { ok: false, error: friendlyClaudeError(e) };
  }
}
const STOP = new Set("the and for what where when who did does said say says about with from that this was were have has had into our your you are any how why can could would should tell show find message messages chat".split(" "));

/** "Catch me up": what happened in a conversation (the unread part, or the latest messages), with anything asked of you. */
export async function chatCatchUp(channel: string, since: number | null): Promise<R<{ summary: string }>> {
  const { supabase, profile } = await requireEmployee();
  if (!claudeReady()) return { ok: false, error: "AMBIT Intelligence isn't set up." };
  const msgs = await loadMessages(supabase, channel, profile.id, await names(supabase), { limit: 120, from: since ?? undefined });
  const lines = msgs.filter((m) => !m.deleted_at && m.kind !== "system").map((m) => `${m.created_at.slice(5, 16).replace("T", " ")} ${m.by}: ${m.body}${m.files.length ? ` [${m.files.length} file(s)]` : ""}${m.reply_count ? ` (${m.reply_count} replies)` : ""}`);
  if (!lines.length) return { ok: true, summary: "Nothing new here." };
  try {
    const { data } = await fillForm<{ summary: string }>({
      model: AI_MODEL,
      maxTokens: 700,
      system: `Summarize a team chat at AMBIT Polyurethane for ${profile.full_name || "the reader"} in plain, short bullets ("- "): decisions, problems, numbers (orders, quantities, dates), and last anything asked of ${profile.full_name || "them"} (start that bullet with "For you:"). At most 7 bullets. No intro.`,
      content: lines.join("\n").slice(-24000),
      name: "summary",
      description: "The summary.",
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    });
    return { ok: true, summary: data.summary };
  } catch (e) {
    return { ok: false, error: friendlyClaudeError(e) };
  }
}

/** Write a reply: from what they said into the mic ("tell him it ships Friday"), or a suggested reply to the latest message. */
export async function chatDraft(channel: string, instruction: string, parent: number | null): Promise<R<{ text: string }>> {
  const { supabase, profile } = await requireEmployee();
  if (!claudeReady()) return { ok: false, error: "AMBIT Intelligence isn't set up." };
  const nm = await names(supabase);
  const msgs = parent ? await loadThread(supabase, parent, profile.id, nm) : await loadMessages(supabase, channel, profile.id, nm, { limit: 25 });
  const ctx = msgs.filter((m) => !m.deleted_at && m.kind !== "system").map((m) => `${m.by}: ${m.body}`).join("\n").slice(-12000);
  const me = profile.full_name || "me";
  try {
    const { data } = await fillForm<{ text: string }>({
      model: AI_MODEL,
      maxTokens: 500,
      system: `You write chat replies for ${me} at AMBIT Polyurethane (spray foam and insulation supply). Sound like a busy, friendly coworker: short, plain, no greetings or sign-offs, no emojis unless the conversation uses them. Never invent facts (prices, dates, quantities) that ${me} didn't give; if something needed is missing, leave a [blank] for them to fill. When ${me} says to tell or ask a specific person, start with @Their Name. Today is ${todayCentral()}.`,
      content: `Conversation so far:\n${ctx || "(nothing yet)"}\n\n${instruction.trim() ? `What ${me} wants to say (spoken, may be rough): ${instruction.trim()}` : `Suggest ${me}'s reply to the latest message.`}`,
      name: "reply",
      description: "The reply to send.",
      schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    });
    return { ok: true, text: data.text.trim().slice(0, 4000) };
  } catch (e) {
    return { ok: false, error: friendlyClaudeError(e) };
  }
}

/** The order's board id (made the first time), for the chat button on order lists. */
export async function chatOrderId(order: string): Promise<R<{ id: string }>> {
  const { supabase } = await requireEmployee();
  const { data, error } = await supabase.rpc("chat_order", { p_order: order });
  return error || !data ? fail(error, "Couldn't open the order's chat.") : { ok: true, id: String(data) };
}
