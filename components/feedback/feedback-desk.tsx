"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, CircleHelp, Inbox, Lightbulb, LoaderCircle, MessageSquareReply, Send, TriangleAlert, Wrench } from "lucide-react";
import { answerFeedback, markFeedbackSeen, sendFeedback } from "@/app/(app)/feedback/actions";
import { AREAS, KINDS, STATUSES, kindLabel, statusOf, type FeedbackRow, type Kind } from "@/lib/feedback";

const ICON: Record<Kind, React.ReactNode> = {
  idea: <Lightbulb size={18} aria-hidden />, question: <CircleHelp size={18} aria-hidden />,
  concern: <TriangleAlert size={18} aria-hidden />, problem: <Wrench size={18} aria-hidden />,
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Send feedback (every admin), your own feedback and its answers, and (Jeremiah) the inbox. */
export function FeedbackDesk({ mine, inbox, ownerName, meId, startInbox, off }: {
  mine: FeedbackRow[]; inbox: FeedbackRow[] | null; ownerName: string; meId: string; startInbox: boolean; off: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"send" | "inbox">(startInbox && inbox ? "inbox" : "send");
  const [kind, setKind] = useState<Kind | "">("");
  const [area, setArea] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const first = ownerName.split(" ")[0];
  const unread = mine.filter((f) => f.replied_at && !f.seen_reply_at).length;
  useEffect(() => { if (unread) void markFeedbackSeen(); }, [unread]);

  const send = () =>
    go(async () => {
      setMsg(null);
      const r = await sendFeedback({ kind, area, subject, body });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: r.msg.replace("Jeremiah", first) });
      setKind(""); setArea(""); setSubject(""); setBody("");
      router.refresh();
    });
  const ready = !!kind && subject.trim().length >= 3 && body.trim().length >= 10 && !off;

  return (
    <div className="col" style={{ gap: 14 }}>
      {inbox ? (
        <div className="seg" role="tablist" aria-label="Feedback">
          <button type="button" role="tab" aria-selected={tab === "send"} className={tab === "send" ? "on" : ""} onClick={() => setTab("send")}><Send size={15} /> Send feedback</button>
          <button type="button" role="tab" aria-selected={tab === "inbox"} className={tab === "inbox" ? "on" : ""} onClick={() => setTab("inbox")}>
            <Inbox size={15} /> Inbox{inbox.filter((f) => f.status === "new").length ? ` (${inbox.filter((f) => f.status === "new").length} new)` : ""}
          </button>
        </div>
      ) : null}

      {tab === "inbox" && inbox ? <InboxList rows={inbox} meId={meId} /> : (
        <>
          <section className="card2 fb-send" aria-label="Send feedback">
            <div className="fb-head">
              <b>Send feedback to {ownerName}</b>
              <span className="small muted">Ideas, questions, concerns and problems with AMBIT Intelligence. It goes straight to {first}, and every one gets an answer here.</span>
            </div>
            <div className="fb-kinds" role="radiogroup" aria-label="What is it">
              {KINDS.map((k) => (
                <button key={k.k} type="button" role="radio" aria-checked={kind === k.k} className={`fb-kind${kind === k.k ? " on" : ""}`} onClick={() => setKind(k.k)}>
                  {ICON[k.k]}<b>{k.label}</b><span>{k.hint}</span>
                </button>
              ))}
            </div>
            <div className="fb-grid">
              <label className="field"><span className="label">Where in A.I.</span>
                <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Pick one (optional)</option>
                  {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="field"><span className="label">Title</span>
                <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Credit holds need a reason the CRM can see" />
              </label>
              <label className="field fb-wide"><span className="label">Details</span>
                <textarea className="textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
                  placeholder="What happened, where, and what you'd change. The more specific, the faster it gets fixed." />
              </label>
            </div>
            {msg ? (
              <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"}>
                {msg.ok ? <CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />}<span>{msg.text}</span>
              </div>
            ) : null}
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={pending || !ready} onClick={send}>{pending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Send to {first}</button>
              <span className="tiny faint">Only {first} reads these.</span>
            </div>
          </section>

          <section className="card2" aria-label="Your feedback">
            <div className="card2-h"><b>Your feedback</b><span className="small faint">{mine.length ? `${mine.length} sent` : ""}</span></div>
            {mine.length ? (
              <ul className="fb-list">
                {mine.map((f) => (
                  <li key={f.id} id={`f-${f.id}`}>
                    <div className="fb-row-h">
                      <span className="fb-ic">{ICON[f.kind]}</span>
                      <span className="col tight grow" style={{ minWidth: 0, gap: 2 }}>
                        <b className="small">{f.subject}</b>
                        <span className="tiny faint">{kindLabel(f.kind)}{f.area ? ` · ${f.area}` : ""} · {when(f.created_at)}</span>
                      </span>
                      <span className={statusOf(f.status).pill}>{statusOf(f.status).label}</span>
                    </div>
                    <p className="small fb-body">{f.body}</p>
                    {f.reply ? (
                      <div className={`fb-reply${!f.seen_reply_at ? " new" : ""}`}>
                        <MessageSquareReply size={16} aria-hidden />
                        <span className="col tight" style={{ gap: 2 }}>
                          <span className="small fb-body">{f.reply}</span>
                          <span className="tiny faint">{f.reply_by_name ?? first}{f.replied_at ? ` · ${when(f.replied_at)}` : ""}{!f.seen_reply_at ? " · new" : ""}</span>
                        </span>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted" style={{ margin: 0, padding: "14px 18px" }}>Nothing sent yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function InboxList({ rows, meId }: { rows: FeedbackRow[]; meId: string }) {
  const [f, setF] = useState<string>("open");
  // Answered just now: stays in view (with its message) until the filter changes.
  const [keep, setKeep] = useState<number[]>([]);
  const shown = useMemo(() => rows.filter((r) => keep.includes(r.id) || (f === "open" ? r.status === "new" || r.status === "reading" : f === "all" ? true : r.kind === f)), [rows, f, keep]);
  const counts = { open: rows.filter((r) => r.status === "new" || r.status === "reading").length, all: rows.length } as Record<string, number>;
  for (const k of KINDS) counts[k.k] = rows.filter((r) => r.kind === k.k).length;
  return (
    <section className="card2" aria-label="Inbox">
      <div className="fb-tools">
        <div className="chips wrap" role="tablist" aria-label="Show">
          {[{ k: "open", label: "Open" }, { k: "all", label: "All" }, ...KINDS.map((k) => ({ k: k.k, label: `${k.label}s` }))].map((x) => (
            <button key={x.k} type="button" role="tab" aria-selected={f === x.k} className={`chip sm${f === x.k ? " on" : ""}`} onClick={() => (setF(x.k), setKeep([]))}>
              {x.label}{counts[x.k] ? ` · ${counts[x.k]}` : ""}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? <ul className="fb-list">{shown.map((r) => <InboxItem key={r.id} r={r} self={r.by_id === meId} onDone={() => setKeep((k) => [...k, r.id])} />)}</ul> : <p className="small muted" style={{ margin: 0, padding: "14px 18px" }}>Nothing here.</p>}
    </section>
  );
}

function InboxItem({ r, self, onDone }: { r: FeedbackRow; self: boolean; onDone: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(r.status === "new" ? "reading" : r.status);
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const save = () =>
    go(async () => {
      setMsg(null);
      const res = await answerFeedback({ id: r.id, status, reply });
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      onDone();
      setMsg({ ok: true, text: res.msg });
      setReply("");
      router.refresh();
    });
  return (
    <li id={`f-${r.id}`}>
      <div className="fb-row-h">
        <span className="fb-ic">{ICON[r.kind]}</span>
        <span className="col tight grow" style={{ minWidth: 0, gap: 2 }}>
          <b className="small">{r.subject}</b>
          <span className="tiny faint">{r.by_name ?? "An admin"}{self ? " (you)" : ""} · {kindLabel(r.kind)}{r.area ? ` · ${r.area}` : ""} · {when(r.created_at)}</span>
        </span>
        <span className={statusOf(r.status).pill}>{statusOf(r.status).label}</span>
      </div>
      <p className="small fb-body">{r.body}</p>
      {r.reply ? (
        <div className="fb-reply"><MessageSquareReply size={16} aria-hidden /><span className="col tight" style={{ gap: 2 }}><span className="small fb-body">{r.reply}</span><span className="tiny faint">{r.replied_at ? when(r.replied_at) : ""}{r.seen_reply_at ? " · read" : " · not read yet"}</span></span></div>
      ) : null}
      <div className="fb-answer">
        <select className="input sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Where it stands">
          {STATUSES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        <input className="input sm" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000} placeholder={r.reply ? "Add to your answer (replaces it)" : "Your answer (optional)"} aria-label="Your answer" />
        <button type="button" className="b2 sm" disabled={pending} onClick={save}>{pending ? <LoaderCircle size={15} className="spin" /> : <MessageSquareReply size={15} />} {reply.trim() ? "Answer" : "Save"}</button>
      </div>
      {msg ? <span className={`small ${msg.ok ? "ok-text" : "err-text"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</span> : null}
    </li>
  );
}
