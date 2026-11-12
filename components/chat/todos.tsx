"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, MessageSquare, Plus } from "lucide-react";
import { todoAdd, todoDone } from "@/app/(app)/chat/actions";
import type { Todo } from "@/lib/chat";

const due = (d: string | null) => {
  if (!d) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const tmrw = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (d < today) return { t: `Overdue · ${new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, late: true };
  if (d === today) return { t: "Today", late: false };
  if (d === tmrw) return { t: "Tomorrow", late: false };
  return { t: new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), late: false };
};

/** My to-dos: from being @mentioned in chat, or added myself. Check one off and it's done. */
export function TodoList({ todos: start, compact = false, adding = true }: { todos: Todo[]; compact?: boolean; adding?: boolean }) {
  const [todos, setTodos] = useState(start);
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState<number | "add" | null>(null);
  const toggle = async (t: Todo) => {
    setBusy(t.id);
    const r = await todoDone(t.id, !t.done_at);
    setBusy(null);
    if (r.ok) setTodos((list) => list.map((x) => (x.id === t.id ? { ...x, done_at: x.done_at ? null : new Date().toISOString() } : x)));
  };
  const add = async () => {
    if (!text.trim()) return;
    setBusy("add");
    const r = await todoAdd(text, when || null, null);
    setBusy(null);
    if (r.ok) {
      setTodos((l) => [{ id: r.id, text: text.trim(), due_on: when || null, channel_id: null, message_id: null, from_name: null, source: "manual", done_at: null, created_at: new Date().toISOString() }, ...l]);
      setText("");
      setWhen("");
    }
  };
  return (
    <div className={`todo-list${compact ? " compact" : ""}`}>
      {todos.length ? (
        todos.map((t) => {
          const d = due(t.due_on);
          return (
            <div key={t.id} className={`todo${t.done_at ? " done" : ""}`}>
              <button type="button" className="todo-check" aria-label={t.done_at ? "Mark not done" : "Mark done"} onClick={() => toggle(t)} disabled={busy === t.id}>
                {busy === t.id ? <LoaderCircle size={19} className="spin" /> : t.done_at ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </button>
              <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="todo-t">{t.text}</span>
                <span className="tiny muted">
                  {d ? <span className={d.late ? "err-text" : ""}>{d.t}</span> : null}
                  {d && t.from_name ? " · " : ""}
                  {t.from_name ? `from ${t.from_name.split(" ")[0]}` : ""}
                </span>
              </div>
              {t.channel_id ? (
                <Link className="iconbtn sm" href={`/chat/${t.channel_id}${t.message_id ? `?m=${t.message_id}` : ""}`} aria-label="Open the message"><MessageSquare size={15} /></Link>
              ) : null}
            </div>
          );
        })
      ) : (
        <span className="small muted">Nothing on your list. When someone @mentions you in chat, it shows up here.</span>
      )}
      {adding ? (
        <form className="todo-add" onSubmit={(e) => (e.preventDefault(), add())}>
          <input className="input sm grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a to-do" aria-label="New to-do" />
          <input className="input sm" type="date" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Due" style={{ width: 150 }} />
          <button type="submit" className="btn sm" disabled={busy === "add" || !text.trim()}>{busy === "add" ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} Add</button>
        </form>
      ) : null}
    </div>
  );
}
