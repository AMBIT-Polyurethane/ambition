"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight, BadgeCheck, BellRing, CalendarClock, CalendarRange, Check, ClipboardCheck, Flame, FlaskConical, PartyPopper, Square, SquareKanban, TrendingDown, Volume2, X,
} from "lucide-react";
import type { SetupStep } from "@/lib/ops/setup";
import type { Brief, BriefIcon } from "@/lib/ops/brief";
import type { CoachStep } from "@/app/(app)/ops/ai-actions";
import { guideSteps } from "@/app/(app)/ops/ai-actions";
import { AtomOrb } from "./orb";
import { openAi } from "./bus";
import { speak, stopSpeaking, type Say } from "./voice";

// The AMBIT Intelligence guide: the atom pops up and talks people through things.
//  - First days (owner / office): the setup walkthrough. "Show me" takes them to each screen, where a
//    small coach at the bottom says exactly what to do there, then on to the next step.
//  - Every day after: the daily briefing, the few things that need them today, each one tappable.
// Shows once a day on OPS Home (remembered on this device); the Home buttons open it any time.

type Store = { setupLater?: string; setupOff?: boolean; brief?: string; coach?: SetupStep["key"] | null };
const key = (u: string) => `ambit-guide:${u}`;
const read = (u: string): Store => {
  try {
    return JSON.parse(localStorage.getItem(key(u)) || "{}") as Store;
  } catch {
    return {};
  }
};
const write = (u: string, p: Partial<Store>) => {
  try {
    localStorage.setItem(key(u), JSON.stringify({ ...read(u), ...p }));
  } catch {}
};

const EVENT = "ambit-guide:open";
export const openGuide = (mode: "setup" | "brief") => window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));

/** Types the words out like someone talking; tap to show it all. */
function useTyping(text: string, run: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    setN(0);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) return setN(text.length);
    let i = 0;
    const id = setInterval(() => {
      i += text[i] === " " ? 2 : 1;
      setN(Math.min(i, text.length));
      if (i >= text.length) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [text, run]);
  return { shown: text.slice(0, n), done: n >= text.length, finish: () => setN(text.length) };
}

const ICONS: Record<BriefIcon, typeof Flame> = {
  chem: FlaskConical,
  trips: CalendarRange,
  tasks: BellRing,
  review: ClipboardCheck,
  follow: SquareKanban,
  quote: Flame,
  yield: TrendingDown,
  unsched: CalendarClock,
  clear: BadgeCheck,
};

export function Guide({ userId, first, today, steps, brief, setupSay, briefSay }: { userId: string; first: string; brand: string; today: string; steps: SetupStep[]; brief: Brief; setupSay: Say; briefSay: Say }) {
  const [mode, setMode] = useState<"setup" | "brief" | null>(null);
  const [talking, setTalking] = useState(false);
  const router = useRouter();
  const left = steps.filter((s) => !s.done);

  useEffect(() => {
    const st = read(userId);
    const t = setTimeout(() => {
      if (left.length && !st.setupOff && st.setupLater !== today && !st.coach) setMode("setup");
      else if (st.brief !== today && brief.items.length) setMode("brief");
    }, 900);
    const h = (e: Event) => setMode((e as CustomEvent<"setup" | "brief">).detail);
    window.addEventListener(EVENT, h);
    return () => {
      clearTimeout(t);
      window.removeEventListener(EVENT, h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    stopSpeaking();
    setTalking(false);
    if (mode === "brief") write(userId, { brief: today });
    if (mode === "setup") write(userId, { setupLater: today });
    setMode(null);
  }, [mode, today, userId]);

  useEffect(() => {
    if (!mode) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mode, close]);

  const setupText = setupSay.text;
  const text = mode === "setup" ? setupText : `${brief.hello} ${brief.lead}`;
  const typing = useTyping(text, !!mode);

  const talk = (words: Say) => {
    if (talking) {
      stopSpeaking();
      setTalking(false);
      return;
    }
    speak(words, { start: () => setTalking(true), end: () => setTalking(false) });
  };

  const startCoach = () => {
    const next = left[0];
    if (!next) return close();
    stopSpeaking();
    write(userId, { coach: next.key, setupLater: today });
    window.dispatchEvent(new Event("ambit-guide:coach"));
    setMode(null);
    router.push(next.href);
  };

  if (!mode) return null;
  const mood = talking ? "speaking" : !typing.done ? "speaking" : "idle";

  return (
    <div className="ag-root" role="dialog" aria-modal="true" aria-label="AMBIT Intelligence guide">
      <div className="ag-scrim" onClick={close} />
      <div className={`ag-card ${mode}`} onClick={() => typing.finish()}>
        <button type="button" className="ag-x" onClick={close} aria-label="Close"><X size={20} /></button>
        <div className="ag-char">
          <AtomOrb size={132} mood={mood} core />
          <span className="ag-name">AMBIT Intelligence</span>
        </div>
        <div className="ag-bubble" aria-live="polite">
          <p>
            {typing.shown}
            {!typing.done ? <i className="ag-caret" /> : null}
          </p>
        </div>

        {mode === "setup" ? (
          <>
            <ol className={`ag-steps${typing.done ? " in" : ""}`}>
              {steps.map((s, i) => (
                <li key={s.key} className={s.done ? "done" : s.key === left[0]?.key ? "next" : ""} style={{ "--i": i } as React.CSSProperties}>
                  <span className="ag-tick">{s.done ? <Check size={14} /> : i + 1}</span>
                  <span className="col tight grow">
                    <b>{s.label}</b>
                    <span className="tiny faint">{s.hint}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="ag-actions">
              {left.length ? (
                <button type="button" className="btn" onClick={startCoach}>
                  Show me <ArrowRight size={16} />
                </button>
              ) : (
                <button type="button" className="btn" onClick={close}>Let&apos;s go</button>
              )}
              <button type="button" className="btn ghost" onClick={() => talk(setupSay)}>
                {talking ? <Square size={14} /> : <Volume2 size={16} />} {talking ? "Stop" : "Read it to me"}
              </button>
              <button type="button" className="linkbtn small" onClick={close}>Later</button>
            </div>
            {left.length ? (
              <button type="button" className="linkbtn tiny ag-off" onClick={() => { write(userId, { setupOff: true }); close(); }}>
                Don&apos;t show the setup guide again (it stays on Home)
              </button>
            ) : null}
          </>
        ) : (
          <>
            <ul className={`ag-brief${typing.done ? " in" : ""}`}>
              {brief.items.map((it, i) => {
                const I = ICONS[it.icon];
                return (
                  <li key={i} style={{ "--i": i } as React.CSSProperties}>
                    <Link href={it.href} className={`ag-item ${it.tone}`} onClick={() => { write(userId, { brief: today }); stopSpeaking(); setMode(null); }}>
                      <span className="ag-ic"><I size={17} /></span>
                      <span className="grow">{it.text}</span>
                      <span className="ag-go">{it.go} <ArrowRight size={13} /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="ag-actions">
              <button type="button" className="btn" onClick={close}>Got it</button>
              <button type="button" className="btn ghost" onClick={() => talk(briefSay)}>
                {talking ? <Square size={14} /> : <Volume2 size={16} />} {talking ? "Stop" : "Read it to me"}
              </button>
              <button type="button" className="btn ghost" onClick={() => { close(); setTimeout(() => openAi(), 150); }}>
                <AtomOrb size={20} /> Ask me something
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Home buttons that bring the guide back. */
export function GuideButton({ mode, className, children }: { mode: "setup" | "brief"; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => openGuide(mode)}>
      {children}
    </button>
  );
}

/**
 * The coach: while someone is walking through setup, a small atom at the bottom of each OPS screen says
 * what to do there, notices when it's done, and takes them to the next step.
 */
export function GuideCoach({ userId }: { userId: string }) {
  const [stepKey, setStepKey] = useState<SetupStep["key"] | null>(null);
  const [steps, setSteps] = useState<CoachStep[] | null>(null);
  const [small, setSmall] = useState(false);
  const [talking, setTalking] = useState(false);
  const path = usePathname() || "/";
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    const load = () => setStepKey(read(userId).coach ?? null);
    load();
    window.addEventListener("ambit-guide:coach", load);
    return () => window.removeEventListener("ambit-guide:coach", load);
  }, [userId]);

  // Check what's done each time they land on a screen (saving a form brings them back here).
  useEffect(() => {
    if (!stepKey) return;
    let live = true;
    guideSteps().then((s) => live && setSteps(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [stepKey, path]);

  if (!stepKey || !steps?.length) return null;
  const i = steps.findIndex((s) => s.key === stepKey);
  const step = steps[i];
  if (!step) return null;
  const here = path === step.href || path.startsWith(step.href + "/");
  const allDone = steps.every((s) => s.done);

  const stop = () => {
    stopSpeaking();
    write(userId, { coach: null });
    setStepKey(null);
  };
  const next = () => {
    if (busy.current) return;
    busy.current = true;
    stopSpeaking();
    const after = [...steps.slice(i + 1), ...steps.slice(0, i)].find((s) => !s.done);
    if (!after) {
      write(userId, { coach: null });
      setStepKey(null);
      router.push("/ops?msg=" + encodeURIComponent(allDone ? "Setup's done. You're ready to run your business on AMBIT-OPS." : "That's the walkthrough. Anything left is on your Home screen."));
    } else {
      write(userId, { coach: after.key });
      setStepKey(after.key);
      router.push(after.href);
    }
    setTimeout(() => (busy.current = false), 600);
  };

  const words = step.done ? step.say.done.text : step.coach;

  return (
    <div className={`ag-coach${small ? " small" : ""}${step.done ? " done" : ""}`} role="status">
      <button type="button" className="ag-coach-orb" onClick={() => setSmall(!small)} aria-label={small ? "Show the guide" : "Shrink the guide"}>
        <AtomOrb size={46} mood={talking ? "speaking" : step.done ? "idle" : "listening"} />
      </button>
      {!small ? (
        <div className="ag-coach-body">
          <span className="ag-coach-step">
            {step.done ? <PartyPopper size={13} /> : null} Setup · step {i + 1} of {steps.length}
          </span>
          <b>{step.label}</b>
          <span className="ag-coach-say">{here || step.done ? words : `Tap Go there and I'll show you what to do.`}</span>
          <div className="ag-coach-actions">
            {!here && !step.done ? (
              <Link href={step.href} className="btn sm">Go there <ArrowRight size={14} /></Link>
            ) : (
              <button type="button" className="btn sm" onClick={next}>
                {step.done ? "Next step" : "Skip for now"} <ArrowRight size={14} />
              </button>
            )}
            <button
              type="button"
              className="ix-icon sm"
              aria-label={talking ? "Stop" : "Read it to me"}
              onClick={() => (talking ? (stopSpeaking(), setTalking(false)) : speak(step.done ? step.say.done : step.say.todo, { start: () => setTalking(true), end: () => setTalking(false) }))}
            >
              {talking ? <Square size={13} /> : <Volume2 size={15} />}
            </button>
            <button type="button" className="ix-icon sm" onClick={stop} aria-label="End the setup guide">
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
