"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, ArrowUp, BellPlus, Check, Mic, Square, SquarePen, UserPlus, Volume2, VolumeX, X } from "lucide-react";
import { Markdown } from "@/components/assistant/markdown";
import { aiSaveLead, aiSaveTask } from "@/app/(app)/ops/ai-actions";
import type { AiCard, LeadDraft, TaskDraft } from "@/lib/ops/ai/tools";
import type { AiSource } from "@/lib/assistant/config";
import { AtomOrb, type OrbMood } from "./orb";
import { onOpenAi, sayState } from "./bus";
import { canListen, sayNext, setServerVoice, speak, stopSpeaking, unlockAudio, useListen, type Say } from "./voice";
import { fillerFor } from "@/lib/ops/ai/fillers";

// The AMBIT Intelligence panel: full screen on a phone, a panel on the right on a computer. Type or
// talk; answers stream in; records are links; "add a lead" and "remind me" come back as cards that save
// with one tap. If you talk to it, it talks back (unless muted). Lives once in the app frame
// (app/(app)/layout.tsx) and opens from the atom buttons (bus.ts). Server: app/api/ops/assistant.

type Msg = {
  id: string;
  role: "user" | "assistant";
  body: string;
  status?: string;
  sources?: AiSource[];
  cards?: AiCard[];
  error?: string;
  streaming?: boolean;
  voice?: boolean;
  say?: Say;
};

/** The spoken part ([[SAY]] … [[/SAY]]) is for the ear only; the screen shows the rest. */
const visible = (body: string) => body.replace(/\[\[SAY\]\][\s\S]*?(?:\[\[\/SAY\]\]|$)/g, "").replace(/\[\[\/?SAY\]?\]?$/, "").trimStart();

/** A different hello each time, like a person would. */
function hello(first: string) {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }));
  const part = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
  const lines = [`${part}, ${first}. What do you need?`, `Hey ${first}. What's on your mind?`, `${part}, ${first}. What can I dig up for you?`, `Hey ${first}. Ask me anything about the business.`];
  return lines[Math.floor(Math.random() * lines.length)];
}

const MUTE_KEY = "ambit-ai-muted";
const uid = () => Math.random().toString(36).slice(2, 10);
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 699px)").matches;

export function AiPanel({ name, field, canEdit, voice: aiVoice }: { name: string; field: boolean; canEdit: boolean; voice: { server: boolean; label: string } }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mic, setMic] = useState(false);
  const path = usePathname() || "/";
  const router = useRouter();
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const openRef = useRef(false);
  openRef.current = open;
  const busyRef = useRef(false);
  busyRef.current = busy;
  const followUp = useRef(false);
  const listenRef = useRef<{ start: (quiet?: boolean) => void; stop: () => void } | null>(null);
  const [greet, setGreet] = useState("");

  useEffect(() => {
    setServerVoice(aiVoice.server);
  }, [aiVoice.server]);

  useEffect(() => {
    setMic(canListen());
    try {
      setMuted(localStorage.getItem(MUTE_KEY) === "1");
    } catch {}
  }, []);

  // The typing box grows with the question (up to about four lines).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
  }, []);

  const patch = useCallback((id: string, f: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === id ? f(m) : m))), []);

  // Conversation mode: after it answers a spoken question out loud, it listens for the follow-up.
  const listenAgain = useCallback(() => {
    if (!openRef.current || mutedRef.current) return;
    if (busyRef.current) {
      followUp.current = true;
      return;
    }
    setTimeout(() => openRef.current && listenRef.current?.start(true), 300);
  }, []);

  const ask = useCallback(
    async (q: string, voice = false) => {
      const question = q.trim();
      if (!question || busy) return;
      stopSpeaking();
      setSpeaking(false);
      setNote(null);
      setText("");
      followUp.current = false;
      const talk = voice && !mutedRef.current;
      let fillerSaid = false;
      let answerSaid = false;
      const sayAnswer = (sayIt: Say) => {
        if (!talk || answerSaid || !sayIt.text) return;
        answerSaid = true;
        sayNext(sayIt, { start: () => setSpeaking(true), end: () => { setSpeaking(false); listenAgain(); } });
      };
      const history = msgsRef.current.filter((m) => !m.error && m.body.trim()).slice(-12).map((m) => ({ role: m.role, body: m.body }));
      const a: Msg = { id: uid(), role: "assistant", body: "", status: "Thinking…", streaming: true, cards: [], voice };
      setMsgs((all) => [...all, { id: uid(), role: "user", body: question, voice }, a]);
      setBusy(true);
      scrollDown();
      const ctl = new AbortController();
      abort.current = ctl;
      let final: Msg | null = null;
      try {
        const res = await fetch("/api/ops/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: question, history, page: path }),
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "AMBIT Intelligence couldn't answer right now.");
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let e: { t: string; text?: string; sig?: string; say?: string; card?: AiCard; body?: string; sources?: AiSource[]; cards?: AiCard[]; message?: string };
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.t === "status") {
              patch(a.id, (m) => ({ ...m, status: e.text || "" }));
              // "One sec, pulling up the schedule." while it looks.
              const f = talk && !fillerSaid && e.text ? fillerFor(e.text) : null;
              if (f) {
                fillerSaid = true;
                sayNext(f, { start: () => setSpeaking(true), end: () => setSpeaking(false) });
              }
            } else if (e.t === "say" && e.text) {
              const sayIt = { text: e.text, sig: e.sig ?? null };
              patch(a.id, (m) => ({ ...m, say: sayIt }));
              sayAnswer(sayIt);
            }
            else if (e.t === "delta") {
              patch(a.id, (m) => ({ ...m, body: m.body + (e.text ?? ""), status: "" }));
              scrollDown();
            } else if (e.t === "card" && e.card) {
              const c = e.card;
              patch(a.id, (m) => ({ ...m, cards: [...(m.cards ?? []).filter((x) => x.id !== c.id), c] }));
              scrollDown();
            } else if (e.t === "done") {
              const sayIt = { text: e.say ?? "", sig: e.sig ?? null };
              final = { ...a, body: e.body ?? "", say: sayIt, sources: e.sources ?? [], cards: e.cards ?? [], streaming: false, status: "" };
              const f = final;
              patch(a.id, () => f);
              sayAnswer(sayIt);
            } else if (e.t === "error") throw new Error(e.message || "Something went wrong.");
          }
        }
        if (!final) throw new Error("The answer was cut off. Try again.");
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          patch(a.id, (m) => ({ ...m, streaming: false, status: "", body: m.body || "Stopped." }));
        } else {
          patch(a.id, (m) => ({ ...m, streaming: false, status: "", error: (err as Error).message }));
        }
      } finally {
        setBusy(false);
        busyRef.current = false;
        abort.current = null;
        scrollDown();
        if (followUp.current) {
          followUp.current = false;
          listenAgain();
        }
      }
      const f = final as Msg | null;
      if (!f) return;
      // "Open the schedule": go there.
      const go = (f.cards ?? []).find((c): c is Extract<AiCard, { kind: "open" }> => c.kind === "open" && c.go);
      if (go) {
        router.push(go.path);
        if (isPhone()) setTimeout(() => setOpen(false), 450);
      }
    },
    [busy, path, patch, router, scrollDown, listenAgain],
  );

  const listen = useListen({
    onText: (t) => setText(t),
    onDone: (t) => {
      if (t) ask(t, true);
    },
    onError: (m) => setNote(m),
  });
  listenRef.current = listen;

  // Opened from a button: maybe straight into listening, or with a question ready.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(
    () =>
      onOpenAi((o) => {
        setOpen(true);
        setNote(null);
        setGreet((g) => g || hello(name.split(/\s+/)[0] || "there"));
        if (o.prompt) {
          if (o.send) setTimeout(() => askRef.current(o.prompt!), 60);
          else {
            setText(o.prompt);
            setTimeout(() => input.current?.focus(), 80);
          }
        } else if (o.listen && canListen()) {
          setTimeout(() => listenRef.current?.start(), 120);
        } else if (!isPhone()) setTimeout(() => input.current?.focus(), 120);
      }),
    [],
  );

  const mood: OrbMood = listen.listening ? "listening" : busy ? "thinking" : speaking ? "speaking" : "idle";
  useEffect(() => sayState({ open, mood }), [open, mood]);

  // Escape closes; the page behind doesn't scroll on a phone.
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", k);
    const phone = isPhone();
    if (phone) document.documentElement.classList.add("ix-lock");
    return () => {
      window.removeEventListener("keydown", k);
      document.documentElement.classList.remove("ix-lock");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    listen.stop();
    stopSpeaking();
    setSpeaking(false);
  };

  const fresh = () => {
    abort.current?.abort();
    stopSpeaking();
    setSpeaking(false);
    setMsgs([]);
    setText("");
    setNote(null);
    setGreet(hello(name.split(/\s+/)[0] || "there"));
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    if (m) {
      stopSpeaking();
      setSpeaking(false);
    }
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {}
  };

  const micTap = () => {
    if (listen.listening) return listen.stop();
    // Talking over it: tap the mic and it stops to listen.
    stopSpeaking();
    setSpeaking(false);
    unlockAudio();
    setNote(null);
    listen.start();
  };

  const hush = () => {
    stopSpeaking();
    setSpeaking(false);
  };

  const first = name.split(/\s+/)[0] || "there";
  const chips = useMemo(
    () =>
      field
        ? [
            { label: "What's my next job?", send: true },
            { label: "Where am I going tomorrow?", send: true },
            { label: "Max pass thickness for AMBI-TITE?", send: true },
            { label: "Re-entry time after spraying?", send: true },
          ]
        : [
            { label: "What's on the schedule today?", send: true },
            { label: "Who should I call back?", send: true },
            { label: "How did we do this month?", send: true },
            { label: "How's our yield?", send: true },
            { label: "Are we short on foam?", send: true },
            ...(canEdit ? [{ label: "Add a lead: ", send: false }, { label: "Remind me to ", send: false }] : []),
          ],
    [field, canEdit],
  );

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(text);
    }
  };

  // Linking out of an answer on a phone: close so they see the screen.
  const onBodyClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a && a.getAttribute("href")?.startsWith("/") && isPhone()) setTimeout(() => setOpen(false), 200);
  };

  const empty = msgs.length === 0;

  return (
    <div className={`ix-root${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="ix-scrim" onClick={close} />
      <section className="ix-panel" role="dialog" aria-modal="true" aria-label="AMBIT Intelligence">
        <header className="ix-head">
          <button type="button" className="ix-head-orb" onClick={hush} aria-label={speaking ? "Stop talking" : "AMBIT Intelligence"}>
            <AtomOrb size={34} mood={mood} />
          </button>
          <span className="col tight grow" style={{ minWidth: 0 }}>
            <b className="ix-title">AMBIT Intelligence {speaking && aiVoice.server ? <span className="ix-ai-pill" title={`This is AI, speaking with ${aiVoice.label}.`}>AI voice</span> : null}</b>
            <span className="ix-sub">{listen.listening ? "Listening…" : busy ? "Working on it…" : speaking ? "Talking… tap the atom to stop" : "Just ask, or tap the mic"}</span>
          </span>
          <button type="button" className="ix-icon" onClick={toggleMute} aria-label={muted ? "Turn talking back on" : "Mute: don't read answers out loud"} title={muted ? "Muted: answers aren't read out loud" : "When you talk to me, I talk back. Tap to mute."}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          {!empty ? (
            <button type="button" className="ix-icon" onClick={fresh} aria-label="New conversation" title="New conversation">
              <SquarePen size={18} />
            </button>
          ) : null}
          <button type="button" className="ix-icon" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="ix-body" ref={scroller} onClick={onBodyClick}>
          {empty ? (
            <div className="ix-hello">
              <AtomOrb size={128} mood={mood} core level={listen.level} />
              <h2>{greet || `Hey ${first}. What do you need?`}</h2>
              <p>Ask about your jobs, schedule, customers and numbers, or anything about AMBIT products.{mic ? " Tap the mic and just talk." : ""}</p>
              {aiVoice.server ? <p className="ix-voice-note">I&apos;m AI. When I talk, it&apos;s with {aiVoice.label}.</p> : null}
              <div className="ix-chips">
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className="ix-chip"
                    onClick={() => {
                      if (c.send) ask(c.label);
                      else {
                        setText(c.label);
                        input.current?.focus();
                      }
                    }}
                  >
                    {c.label.replace(/[: ]+$/, "")}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ix-thread">
              {msgs.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="ix-q">
                    {m.voice ? <Mic size={13} className="ix-q-mic" aria-label="Asked by voice" /> : null}
                    {m.body}
                  </div>
                ) : (
                  <div key={m.id} className="ix-a">
                    {m.streaming && !visible(m.body) ? (
                      <div className="ix-working">
                        <AtomOrb size={26} mood="thinking" />
                        <span>{m.status || "Thinking…"}</span>
                      </div>
                    ) : null}
                    {visible(m.body) ? (
                      <div className={`ix-md${m.streaming ? " streaming" : ""}`}>
                        <Markdown text={visible(m.body)} />
                      </div>
                    ) : null}
                    {m.streaming && visible(m.body) && m.status ? <div className="ix-working small"><span>{m.status}</span></div> : null}
                    {m.error ? <div className="ix-err">{m.error}</div> : null}
                    {(m.cards ?? []).map((c) => (
                      <CardView key={c.id} card={c} onNav={() => isPhone() && setTimeout(() => setOpen(false), 150)} />
                    ))}
                    {m.sources?.length ? (
                      <div className="ix-srcs">
                        {m.sources.map((s) => (
                          <a key={s.n} id={`src-${s.n}`} href={s.href} target={s.kind === "web" ? "_blank" : undefined} rel="noopener noreferrer" className="ix-src">
                            <b>{s.n}</b> {s.title}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {!m.streaming && m.body ? (
                      <button type="button" className="ix-read" onClick={() => (speaking ? (stopSpeaking(), setSpeaking(false)) : speak(m.say?.text ? m.say : visible(m.body), { start: () => setSpeaking(true), end: () => setSpeaking(false) }))}>
                        {speaking ? <Square size={12} /> : <Volume2 size={13} />} {speaking ? "Stop" : "Read it to me"}
                      </button>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        <footer className={`ix-foot${listen.listening ? " on" : ""}`}>
          {note ? <div className="ix-note">{note}</div> : null}
          {listen.listening ? (
            <div className="ix-listen">
              <span className="ix-wave" aria-hidden="true" style={{ "--lvl": listen.level.toFixed(3) } as React.CSSProperties}>
                <i /><i /><i /><i /><i />
              </span>
              <span className="grow ix-live">{text || "Listening… go ahead and talk."}</span>
              <button type="button" className="ix-mic on" onClick={micTap} aria-label="Stop listening">
                <Square size={18} />
              </button>
            </div>
          ) : (
            <div className="ix-compose">
              <textarea
                ref={input}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder={mic ? "Ask anything, or tap the mic" : "Ask anything"}
                aria-label="Ask AMBIT Intelligence"
                enterKeyHint="send"
              />
              {busy ? (
                <button type="button" className="ix-send" onClick={() => abort.current?.abort()} aria-label="Stop">
                  <Square size={16} />
                </button>
              ) : text.trim() ? (
                <button type="button" className="ix-send" onClick={() => ask(text)} aria-label="Send">
                  <ArrowUp size={20} />
                </button>
              ) : speaking ? (
                <>
                  <button type="button" className="ix-send ghost" onClick={hush} aria-label="Stop talking" title="Stop talking">
                    <Square size={15} />
                  </button>
                  {mic ? (
                    <button type="button" className="ix-mic" onClick={micTap} aria-label="Interrupt and talk" title="Cut in and talk">
                      <Mic size={20} />
                    </button>
                  ) : null}
                </>
              ) : mic ? (
                <button type="button" className="ix-mic" onClick={micTap} aria-label="Talk">
                  <Mic size={20} />
                </button>
              ) : null}
            </div>
          )}
        </footer>
      </section>
    </div>
  );

}

function CardView({ card, onNav }: { card: AiCard; onNav: () => void }) {
  if (card.kind === "open") {
    return (
      <Link href={card.path} className="ix-card open" onClick={onNav}>
        <span className="grow">{card.label}</span>
        <ArrowRight size={16} />
      </Link>
    );
  }
  if (card.kind === "lead") return <LeadCard draft={card.draft} />;
  return <TaskCard draft={card.draft} />;
}

// ------------------------------------------------------------------ cards that save with one tap

function LeadCard({ draft }: { draft: LeadDraft }) {
  const [d, setD] = useState<LeadDraft>(draft);
  const [state, setState] = useState<"edit" | "saving" | "saved">("edit");
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = useState<{ number: number | null; path: string } | null>(null);
  const set = (k: keyof LeadDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value || null });

  const save = async (opts: { useCustomer?: string; anyway?: boolean } = {}) => {
    setState("saving");
    setErr(null);
    const r = await aiSaveLead(d, opts).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection and try again." }));
    if (r.ok) {
      setSaved({ number: r.number, path: r.path });
      setState("saved");
    } else {
      setErr(r.error);
      setDup("dup" in r && r.dup ? r.dup : null);
      setState("edit");
    }
  };

  if (state === "saved" && saved) {
    return (
      <div className="ix-card done">
        <Check size={18} />
        <span className="grow">Saved as <b>Lead #{saved.number ?? ""}</b>. It&apos;s in New leads.</span>
        <Link href={saved.path} className="ix-card-link">Open <ArrowRight size={14} /></Link>
      </div>
    );
  }
  const existing = !!d.customer_id;
  return (
    <div className="ix-card form">
      <div className="ix-card-h"><UserPlus size={16} /> New lead <span className="tiny faint">Check it, then save</span></div>
      {existing ? (
        <div className="ix-f-row"><span className="ix-f-l">Customer</span><b>{d.customer_name}</b></div>
      ) : (
        <>
          <div className="ix-f-2">
            <label><span>First name</span><input value={d.first_name ?? ""} onChange={set("first_name")} /></label>
            <label><span>Last name</span><input value={d.last_name ?? ""} onChange={set("last_name")} /></label>
          </div>
          {d.company_name ? <label><span>Company</span><input value={d.company_name ?? ""} onChange={set("company_name")} /></label> : null}
          <div className="ix-f-2">
            <label><span>Phone</span><input value={d.phone ?? ""} onChange={set("phone")} inputMode="tel" /></label>
            <label><span>Email</span><input value={d.email ?? ""} onChange={set("email")} inputMode="email" /></label>
          </div>
        </>
      )}
      <label><span>Address</span><input value={d.street ?? ""} onChange={set("street")} placeholder="Street" /></label>
      <div className="ix-f-3">
        <input value={d.city ?? ""} onChange={set("city")} placeholder="City" aria-label="City" />
        <input value={d.state ?? ""} onChange={set("state")} placeholder="ST" aria-label="State" maxLength={2} />
        <input value={d.zip ?? ""} onChange={set("zip")} placeholder="ZIP" aria-label="ZIP" inputMode="numeric" />
      </div>
      <label><span>The job</span><input value={d.title ?? ""} onChange={set("title")} placeholder="Attic, open cell" /></label>
      {d.notes ? <label><span>Notes</span><input value={d.notes ?? ""} onChange={set("notes")} /></label> : null}
      {d.value_est || d.next_at || d.source ? (
        <div className="tiny faint">
          {[d.value_est ? `About $${Math.round(d.value_est).toLocaleString()}` : null, d.next_at ? `Follow up ${new Date(`${d.next_at}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : null, d.source ? `From ${d.source}` : null].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      {err ? <div className="ix-err">{err}</div> : null}
      <div className="ix-card-actions">
        {dup ? (
          <>
            <button type="button" className="btn sm" disabled={state === "saving"} onClick={() => save({ useCustomer: dup.id })}>Add it to {dup.name}</button>
            <button type="button" className="btn sm ghost" disabled={state === "saving"} onClick={() => save({ anyway: true })}>New customer anyway</button>
          </>
        ) : (
          <button type="button" className="btn sm" disabled={state === "saving"} onClick={() => save()}>
            <Check size={15} /> {state === "saving" ? "Saving…" : "Save lead"}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskCard({ draft }: { draft: TaskDraft }) {
  const [d, setD] = useState<TaskDraft>(draft);
  const [state, setState] = useState<"edit" | "saving" | "saved">("edit");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setState("saving");
    setErr(null);
    const r = await aiSaveTask(d).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection and try again." }));
    if (r.ok) setState("saved");
    else {
      setErr(r.error);
      setState("edit");
    }
  };
  if (state === "saved") {
    return (
      <div className="ix-card done">
        <Check size={18} />
        <span className="grow">Reminder saved{d.due_on ? ` for ${new Date(`${d.due_on}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}` : ""}. It&apos;s on your Home list.</span>
      </div>
    );
  }
  return (
    <div className="ix-card form">
      <div className="ix-card-h"><BellPlus size={16} /> Reminder {d.about ? <span className="tiny faint">{d.about}</span> : null}</div>
      <label><span>What</span><input value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} /></label>
      <label><span>When</span><input type="date" value={d.due_on ?? ""} onChange={(e) => setD({ ...d, due_on: e.target.value || null })} /></label>
      {err ? <div className="ix-err">{err}</div> : null}
      <div className="ix-card-actions">
        <button type="button" className="btn sm" disabled={state === "saving" || !d.body.trim()} onClick={save}>
          <Check size={15} /> {state === "saving" ? "Saving…" : "Save reminder"}
        </button>
      </div>
    </div>
  );
}
