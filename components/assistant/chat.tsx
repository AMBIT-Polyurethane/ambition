"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Camera,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  Globe,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { BrandImg } from "@/components/brand";
import { Markdown } from "@/components/assistant/markdown";
import { kindInfo, NO_SOURCE_MARK, type AiSource } from "@/lib/assistant/config";
import { deleteThread, markThreadRead, rateAnswer, sendToExpert } from "@/app/(app)/assistant/actions";
import { startComplaint } from "@/app/(app)/complaints/actions";
import { uploadPhotos, type Uploaded } from "@/lib/photo-upload";

export type ChatThread = { id: string; title: string; unread: boolean; updated_at: string };
export type ChatMessage = {
  id: number | string;
  role: "user" | "assistant" | "expert";
  body: string;
  sources?: AiSource[] | null;
  no_source?: boolean;
  rating?: number | null;
  author_name?: string | null;
  created_at?: string;
  streaming?: boolean;
  /** Photo links to show (local previews while sending, signed links from history). */
  images?: string[] | null;
  /** Ask AMBIT thinks this is a product problem worth a complaint report. */
  complaint?: boolean;
};

const MAX_PHOTOS = 4;

const SUGGEST_STAFF = [
  "How do I send my expense report to Corporate?",
  "What does TSB-014 say about minor open-cell separation?",
  "How do I set the scale on a plan sheet in Takeoff?",
  "What's the re-occupancy time for AMBI-SEAL 5.0?",
];
const SUGGEST_CUSTOMER = [
  "What's the re-occupancy time for AMBI-SEAL 5.0?",
  "How do I reorder my last order?",
  "Does closed-cell foam on a roof deck need a thermal barrier?",
  "What does AMBIT recommend for bath fan sizing?",
];

function ago(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const plain = (body: string) => body.replace(/⟦[\d,\s]+⟧/g, "").trim();
/** While an answer streams in, hide the "no source" marker (and any half of it). */
const shown = (body: string) => body.split(NO_SOURCE_MARK).join("").replace(/\[\[[A-Z_]*\]?$/, "");

export function AssistantChat(props: {
  threads: ChatThread[];
  threadId: string | null;
  messages: ChatMessage[];
  sentToExpert: Record<string, string>;
  configured: boolean;
  left: number | null;
  staff: boolean;
  admin: boolean;
}) {
  const [threads, setThreads] = useState(props.threads);
  const [threadId, setThreadId] = useState(props.threadId);
  const [messages, setMessages] = useState(props.messages);
  const [sent, setSent] = useState(props.sentToExpert);
  const [left, setLeft] = useState(props.left);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pics, setPics] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Keep following the answer as it streams in, unless they scrolled up to read.
  useEffect(() => {
    const onScroll = () => {
      stick.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);
  useEffect(() => {
    if (props.threadId && props.threads.find((t) => t.id === props.threadId)?.unread) {
      markThreadRead(props.threadId).catch(() => null);
      setThreads((ts) => ts.map((t) => (t.id === props.threadId ? { ...t, unread: false } : t)));
    }
  }, [props.threadId, props.threads]);

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PHOTOS - pics.length;
    if (room <= 0) {
      setError(`Up to ${MAX_PHOTOS} photos per question.`);
      return;
    }
    setError("");
    setUploading(true);
    const up = await uploadPhotos(Array.from(files).slice(0, room), "ask");
    if (files.length > room) up.errors.push(`Only ${MAX_PHOTOS} photos fit in one question.`);
    if (up.errors.length) setError(up.errors.join(" "));
    setPics((p) => [...p, ...up.ok].slice(0, MAX_PHOTOS));
    if (picker.current) picker.current.value = "";
    setUploading(false);
  };

  const ask = useCallback(
    async (q: string) => {
      const sending = pics;
      const question = q.trim();
      if ((!question && !sending.length) || busy || uploading) return;
      setError("");
      setBusy(true);
      setStatus(sending.length ? `Looking at your photo${sending.length > 1 ? "s" : ""}…` : "Searching AMBIT knowledge…");
      setText("");
      setPics([]);
      requestAnimationFrame(grow);
      stick.current = true;
      const tmp = `tmp-${Date.now()}`;
      setMessages((m) => [
        ...m,
        { id: tmp, role: "user", body: question, images: sending.map((p) => p.url) },
        { id: "draft", role: "assistant", body: "", streaming: true },
      ]);

      let res: Response;
      try {
        res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thread: threadId, text: question, images: sending.map((p) => p.path) }),
        });
      } catch {
        res = new Response(JSON.stringify({ error: "No connection. Check your signal and try again." }), { status: 0 });
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Something went wrong. Try again.");
        setMessages((m) => m.filter((x) => x.id !== "draft" && x.id !== tmp));
        setText(question);
        setPics(sending);
        setBusy(false);
        setStatus("");
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let gotDone = false;
      const handle = (e: { t: string; [k: string]: unknown }) => {
        if (e.t === "thread") {
          const id = String(e.id);
          if (typeof e.left === "number") setLeft(e.left);
          setThreadId(id);
          setThreads((ts) => {
            const rest = ts.filter((t) => t.id !== id);
            const mine = ts.find((t) => t.id === id) ?? { id, title: (question || "Photo question").slice(0, 80), unread: false, updated_at: new Date().toISOString() };
            return [{ ...mine, updated_at: new Date().toISOString() }, ...rest];
          });
          if (!threadId) window.history.replaceState(null, "", `/assistant?t=${id}`);
        } else if (e.t === "status") setStatus(String(e.text ?? ""));
        else if (e.t === "delta") {
          setStatus("");
          setMessages((m) => m.map((x) => (x.id === "draft" ? { ...x, body: x.body + String(e.text ?? "") } : x)));
        } else if (e.t === "done") {
          gotDone = true;
          const msg = e.message as ChatMessage;
          setMessages((m) => m.map((x) => (x.id === "draft" ? { ...msg, streaming: false } : x)));
        } else if (e.t === "error") {
          gotDone = true;
          setError(String(e.message ?? "Something went wrong."));
          setMessages((m) => m.filter((x) => x.id !== "draft"));
        }
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) {
              try {
                handle(JSON.parse(line));
              } catch {}
            }
          }
        }
      } catch {
        if (!gotDone) setError("The connection dropped before the answer finished. Try again.");
      }
      if (!gotDone) setMessages((m) => m.map((x) => (x.id === "draft" ? { ...x, streaming: false } : x)));
      setBusy(false);
      setStatus("");
    },
    [busy, threadId, pics, uploading],
  );

  const newChat = () => {
    setThreadId(null);
    setMessages([]);
    setError("");
    setPics([]);
    setShowHistory(false);
    window.history.replaceState(null, "", "/assistant");
    setTimeout(() => box.current?.focus(), 50);
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    await deleteThread(id);
    setThreads((ts) => ts.filter((t) => t.id !== id));
    if (id === threadId) newChat();
  };

  const list = (
    <div className="ai-threads">
      <div className="ai-threads-head">
        <button type="button" className="btn sm block" onClick={newChat}>
          <MessageSquarePlus size={16} /> New question
        </button>
        <button type="button" className="iconbtn ai-hist-close" onClick={() => setShowHistory(false)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {threads.length ? (
        <nav className="ai-thread-list" aria-label="Your conversations">
          {threads.map((t) => (
            <div key={t.id} className={`ai-thread${t.id === threadId ? " on" : ""}`}>
              <Link href={`/assistant?t=${t.id}`} onClick={() => setShowHistory(false)} className="grow">
                <span className="ellipsis">{t.unread ? <i className="ai-dot" aria-label="New answer" /> : null}{t.title}</span>
                <small>{ago(t.updated_at)}</small>
              </Link>
              {confirmDelete === t.id ? (
                <button type="button" className="ai-del sure" onClick={() => remove(t.id)}>Delete</button>
              ) : (
                <button type="button" className="ai-del" onClick={() => setConfirmDelete(t.id)} aria-label="Delete conversation">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </nav>
      ) : (
        <p className="tiny faint" style={{ padding: "4px 6px" }}>Your questions show up here.</p>
      )}
    </div>
  );

  return (
    <main className={`ai-page${showHistory ? " hist" : ""}`}>
      <aside className="ai-side">{list}</aside>

      <section className="ai-chat">
        <header className="ai-head">
          <button type="button" className="iconbtn ai-hist-btn" onClick={() => setShowHistory(true)} aria-label="Your conversations">
            <History size={20} />
          </button>
          <div className="ai-title">
            <BrandImg art="atom-mark" width={26} height={26} />
            <h1>Ask AMBIT</h1>
          </div>
          <button type="button" className="iconbtn" onClick={newChat} aria-label="New question" title="New question">
            <MessageSquarePlus size={20} />
          </button>
        </header>

        {!props.configured ? (
          <div className="alert info small" style={{ margin: "0 0 12px" }}>
            {props.admin ? (
              <span>
                Ask AMBIT needs its Claude connection: add <code>ANTHROPIC_API_KEY</code> in Vercel, then Redeploy. Details in{" "}
                <Link href="/admin/assistant">Admin → Ask AMBIT</Link>.
              </span>
            ) : (
              <span>Ask AMBIT is almost ready. Check back soon.</span>
            )}
          </div>
        ) : null}

        <div className="ai-msgs">
          {messages.length === 0 ? (
            <div className="ai-hello">
              <BrandImg art="atom-mark" width={64} height={64} />
              <h2>What can I help with?</h2>
              <p>
                Answers come only from AMBIT&apos;s own teaching and technical bulletins, AMBIT product documents, the ICC codes (IECC, IRC, IBC),
                ACCA and ASHRAE, and neutral science. Never from the spray foam industry.
              </p>
              <div className="ai-suggest">
                {(props.staff ? SUGGEST_STAFF : SUGGEST_CUSTOMER).map((s) => (
                  <button key={s} type="button" disabled={!props.configured || busy} onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <MessageView
                key={m.id}
                m={m}
                threadId={threadId}
                sentStatus={sent[String(m.id)]}
                onSent={(id) => setSent((s) => ({ ...s, [String(id)]: "open" }))}
                onRated={(id, r) => setMessages((ms) => ms.map((x) => (x.id === id ? { ...x, rating: r } : x)))}
              />
            ))
          )}
          {status ? (
            <div className="ai-status" role="status">
              <LoaderCircle size={15} className="spin" /> {status}
            </div>
          ) : null}
          {error ? (
            <div className="alert err small" role="alert">
              {error}
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form
          className="ai-compose"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          {pics.length || uploading ? (
            <div className="ai-pics">
              {pics.map((p, i) => (
                <div key={p.path} className="photo-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo ${i + 1}`} />
                  <button type="button" aria-label="Remove photo" onClick={() => setPics((ps) => ps.filter((x) => x.path !== p.path))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              {uploading ? (
                <div className="photo-thumb wait" aria-label="Adding photo">
                  <LoaderCircle size={18} className="spin" />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="ai-compose-box">
            <button
              type="button"
              className="ai-cam"
              onClick={() => picker.current?.click()}
              disabled={!props.configured || busy || uploading || pics.length >= MAX_PHOTOS}
              aria-label="Add photos"
              title="Add photos (camera or library)"
            >
              <Camera size={19} />
            </button>
            <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            <textarea
              ref={box}
              value={text}
              rows={1}
              maxLength={4000}
              placeholder={!props.configured ? "Ask AMBIT isn't connected yet" : pics.length ? "What should Ask AMBIT look at? (optional)" : "Ask AMBIT a question…"}
              disabled={!props.configured}
              onChange={(e) => {
                setText(e.target.value);
                grow();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(text);
                }
              }}
              aria-label="Your question"
            />
            <button type="submit" className="ai-send" disabled={(!text.trim() && !pics.length) || busy || uploading || !props.configured} aria-label="Send">
              {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} strokeWidth={2.4} />}
            </button>
          </div>
          <p className="ai-fine">
            Uses only AMBIT-approved sources. Tap the camera to show Ask AMBIT a foam problem. Codes vary by location: confirm with your building department.
            {left != null && left <= 10 ? ` ${Math.max(left, 0)} question${left === 1 ? "" : "s"} left today.` : ""}
          </p>
        </form>
      </section>
      {showHistory ? <button type="button" className="ai-scrim" aria-label="Close" onClick={() => setShowHistory(false)} /> : null}
    </main>
  );
}

function MessageView({
  m,
  threadId,
  sentStatus,
  onSent,
  onRated,
}: {
  m: ChatMessage;
  threadId: string | null;
  sentStatus?: string;
  onSent: (id: number | string) => void;
  onRated: (id: number | string, r: number | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [why, setWhy] = useState<null | "open" | "saving">(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState("");
  const router = useRouter();
  const saved = typeof m.id === "number";

  if (m.role === "user") {
    return (
      <div className="ai-msg user">
        {m.images?.length ? (
          <div className="ai-msg-pics">
            {m.images.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="photo-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Photo ${i + 1}`} />
              </a>
            ))}
          </div>
        ) : null}
        {m.body ? <div className="ai-bubble">{m.body}</div> : null}
      </div>
    );
  }

  const report = async () => {
    if (!threadId || starting) return;
    setStarting(true);
    setStartErr("");
    const r = await startComplaint(threadId);
    if (r.id) router.push(`/complaints/${r.id}`);
    else {
      setStartErr(r.error ?? "Couldn't start the report.");
      setStarting(false);
    }
  };

  if (m.role === "expert") {
    return (
      <div className="ai-msg expert">
        <div className="ai-expert-head">
          <UserRound size={15} /> Answer from AMBIT&apos;s expert{m.author_name ? ` · ${m.author_name}` : ""}
        </div>
        <Markdown text={m.body} />
      </div>
    );
  }

  const cite = (n: number) => {
    const el = document.getElementById(`src-${m.id}-${n}`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setFlash(n);
    setTimeout(() => setFlash(null), 1400);
  };

  const rate = async (r: number) => {
    if (!saved) return;
    const next = m.rating === r ? null : r;
    onRated(m.id, next);
    await rateAnswer(m.id as number, next ?? 0);
    if (next === -1) setWhy("open");
    else setWhy(null);
  };

  const toExpert = async () => {
    if (!saved || sending) return;
    setSending(true);
    const r = await sendToExpert(m.id as number, note);
    setSending(false);
    if (r?.ok) {
      onSent(m.id);
      setWhy(null);
    }
  };

  return (
    <div className="ai-msg bot">
      <div className="ai-avatar" aria-hidden="true">
        <BrandImg art="atom-mark" width={22} height={22} />
      </div>
      <div className="ai-body">
        {m.body ? <Markdown text={m.streaming ? shown(m.body) : m.body} onCite={cite} /> : m.streaming ? <span className="ai-typing"><i /><i /><i /></span> : null}

        {m.sources?.length ? (
          <ol className="ai-sources">
            {m.sources.map((s) => {
              const web = s.kind === "web";
              const internal = s.href.startsWith("/") && !s.href.startsWith("/docs/open/") && !s.href.includes("#page=");
              return (
                <li key={s.n} id={`src-${m.id}-${s.n}`} className={flash === s.n ? "flash" : ""}>
                  <span className="n">{s.n}</span>
                  <a href={s.href} {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })} title={s.quote ?? undefined}>
                    <span className="t">{s.title}</span>
                    <span className="k">
                      {web ? <Globe size={12} /> : null}
                      {web ? s.site : kindInfo(s.kind).short}
                      {s.page ? ` · page ${s.page}` : ""}
                      {internal ? null : <ExternalLink size={11} />}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        ) : null}

        {!m.streaming && saved ? (
          <>
            {m.no_source && !sentStatus ? (
              <div className="ai-nosrc">
                <span>No approved AMBIT source covers this yet. AMBIT&apos;s expert can answer it, and the answer comes back here.</span>
                <button type="button" className="btn sm" onClick={toExpert} disabled={sending}>
                  {sending ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} Send to AMBIT&apos;s expert
                </button>
              </div>
            ) : null}
            {m.complaint && threadId ? (
              <div className="ai-nosrc ai-ccr">
                <span>Want AMBIT to look into this? Ask AMBIT can start a complaint report with these photos and details already filled in. You check it, then submit.</span>
                <button type="button" className="btn sm dark" onClick={report} disabled={starting}>
                  {starting ? <LoaderCircle size={15} className="spin" /> : <ClipboardList size={15} />} {starting ? "Filling it in…" : "Start a complaint report"}
                </button>
                {startErr ? <span className="small" style={{ color: "var(--red)" }}>{startErr}</span> : null}
              </div>
            ) : null}
            {sentStatus ? (
              <div className="ai-sent">
                <Check size={15} /> {sentStatus === "answered" ? "AMBIT's expert answered below." : "Sent to AMBIT's expert. The answer will show up in this conversation."}
              </div>
            ) : null}
            <div className="ai-actions">
              <button type="button" className={m.rating === 1 ? "on" : ""} onClick={() => rate(1)} aria-label="Helpful" title="Helpful">
                <ThumbsUp size={15} />
              </button>
              <button type="button" className={m.rating === -1 ? "on" : ""} onClick={() => rate(-1)} aria-label="Not helpful" title="Not helpful">
                <ThumbsDown size={15} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(plain(m.body)).catch(() => null);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                aria-label="Copy answer"
                title="Copy"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              {!m.no_source && !sentStatus && why === null ? (
                <button type="button" className="txt" onClick={() => setWhy("open")}>
                  Not right? Ask AMBIT&apos;s expert
                </button>
              ) : null}
            </div>
            {why === "open" && !sentStatus ? (
              <div className="ai-why">
                <textarea
                  className="textarea"
                  rows={2}
                  value={note}
                  maxLength={1000}
                  placeholder="What was wrong or missing? (optional)"
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn sm dark"
                    onClick={async () => {
                      if (note.trim()) await rateAnswer(m.id as number, m.rating ?? -1, note);
                      setWhy(null);
                    }}
                  >
                    {note.trim() ? "Send feedback" : "Close"}
                  </button>
                  <button type="button" className="btn sm" onClick={toExpert} disabled={sending}>
                    {sending ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} Send to AMBIT&apos;s expert
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
