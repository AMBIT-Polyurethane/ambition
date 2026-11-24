"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, LoaderCircle, MapPin, MessageSquareText, NotebookPen, Phone, Mail, Plus, Users } from "lucide-react";
import { logActivity, saveTask, taskDone } from "@/app/(app)/sales/actions";
import { KINDS, type Activity, type Task } from "@/lib/crm-shared";

const ICON: Record<string, typeof Phone> = { call: Phone, visit: MapPin, text: MessageSquareText, email: Mail, meeting: Users, note: NotebookPen };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plusDays = (n: number) => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};

/** Log a call / visit / text / email / note, with an optional follow-up. */
export function LogForm({ company, lead }: { company?: string; lead?: string }) {
  const router = useRouter();
  const [kind, setKind] = useState("call");
  const [body, setBody] = useState("");
  const [follow, setFollow] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(plusDays(7));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const save = () =>
    go(async () => {
      setMsg(null);
      const r = await logActivity({ company_id: company ?? null, lead_id: lead ?? null, kind, body, follow_up: follow ? { title, due_on: due } : null });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setBody("");
      setTitle("");
      setFollow(false);
      setMsg({ ok: true, text: follow ? "Saved, with the follow-up." : "Saved." });
      router.refresh();
    });
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="chips wrap" role="radiogroup" aria-label="What happened">
        {KINDS.map((k) => {
          const I = ICON[k.key];
          return (
            <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} className={`chip sm${kind === k.key ? " on" : ""}`} onClick={() => setKind(k.key)}>
              <I size={14} aria-hidden /> {k.label}
            </button>
          );
        })}
      </div>
      <textarea className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened? (Talked to Jim, needs 4 sets of closed cell next week…)" aria-label="What happened" />
      <label className="check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Add a follow-up</label>
      {follow ? (
        <div className="crm-follow">
          <input className="input sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call back about the 4 sets" aria-label="Follow-up" />
          <input className="input sm" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
        </div>
      ) : null}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="b2 sm" onClick={save} disabled={pending || body.trim().length < 2}>
          {pending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Save
        </button>
        {msg ? <span className={`small ${msg.ok ? "ok-text" : "err-text"}`} role="status">{msg.text}</span> : null}
      </div>
    </div>
  );
}

/** What happened with a customer or lead, newest first. */
export function ActivityList({ items, empty = "Nothing logged yet." }: { items: Activity[]; empty?: string }) {
  if (!items.length) return <p className="small muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="crm-acts">
      {items.map((a) => {
        const I = ICON[a.kind] ?? NotebookPen;
        return (
          <li key={a.id}>
            <span className="ic" aria-hidden><I size={15} /></span>
            <span className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="tiny faint">{KINDS.find((k) => k.key === a.kind)?.label ?? a.kind} · {a.created_by_name ?? ""} · {when(a.occurred_at)}</span>
              <span className="small" style={{ whiteSpace: "pre-wrap" }}>{a.body}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Follow-ups: tick when done; add one. */
export function TaskList({ tasks, company, lead, names, showAdd = true, today }: { tasks: Task[]; company?: string; lead?: string; names?: Record<string, string>; showAdd?: boolean; today: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(plusDays(3));
  const [err, setErr] = useState<string | null>(null);
  const [gone, setGone] = useState<number[]>([]);
  const [pending, go] = useTransition();
  const tick = (t: Task) =>
    go(async () => {
      setGone((g) => [...g, t.id]);
      const r = await taskDone(t.id, true, t.company_id);
      if (!r.ok) {
        setGone((g) => g.filter((x) => x !== t.id));
        setErr(r.error);
      } else router.refresh();
    });
  const add = () =>
    go(async () => {
      setErr(null);
      const r = await saveTask({ company_id: company ?? null, lead_id: lead ?? null, title, due_on: due });
      if (!r.ok) return setErr(r.error);
      setTitle("");
      router.refresh();
    });
  const list = tasks.filter((t) => !gone.includes(t.id));
  return (
    <div className="col" style={{ gap: 8 }}>
      {list.length ? (
        <ul className="crm-tasks">
          {list.map((t) => {
            const late = t.due_on && t.due_on < today;
            const now = t.due_on === today;
            const where = t.company_id && names?.[t.company_id];
            return (
              <li key={t.id}>
                <button type="button" className="crm-tick" aria-label={`Done: ${t.title}`} onClick={() => tick(t)} disabled={pending}><Check size={14} /></button>
                <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                  <span className="small">{t.title}</span>
                  <span className="tiny faint">
                    {where ? <><Link href={`/sales/customers/${t.company_id}`}>{where}</Link> · </> : null}
                    {t.due_on ? <span className={late ? "err-text" : now ? "warn-text" : undefined}><CalendarClock size={12} aria-hidden /> {late ? "Late: " : now ? "Today: " : ""}{t.due_on}</span> : "No date"}
                    {t.source === "ai" ? " · suggested by AI" : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>No open follow-ups.</p>
      )}
      {showAdd ? (
        <div className="crm-follow">
          <input className="input sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a follow-up" aria-label="New follow-up" onKeyDown={(e) => e.key === "Enter" && title.trim().length > 1 && add()} />
          <input className="input sm" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
          <button type="button" className="b2 quiet sm" onClick={add} disabled={pending || title.trim().length < 2}><Plus size={15} /> Add</button>
        </div>
      ) : null}
      {err ? <div className="alert err small" role="alert">{err}</div> : null}
    </div>
  );
}
