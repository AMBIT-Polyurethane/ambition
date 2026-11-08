"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voice for AMBIT Intelligence, all inside the browser (nothing extra to install or pay for):
//  - listening: the browser's speech recognition (Chrome, Edge, Safari on iPhone / iPad / Mac). Where a
//    browser doesn't have it (Firefox), the mic button hides and the keyboard's own mic still works.
//  - talking: the device's built-in voices, the most natural one it has.

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

const recCtor = (): (new () => Rec) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = () => !!recCtor();
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

const isApple = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it for this site in your browser settings, or type instead.",
  "service-not-allowed": "Voice isn't available in this browser. Type instead, or use the mic on your keyboard.",
  "audio-capture": "No microphone was found.",
  network: "Voice needs an internet connection.",
};

/** Press to talk: live words while speaking, then the final text when they stop. */
export function useListen(opts: { onText: (text: string) => void; onDone: (text: string) => void; onError: (msg: string) => void }) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const rec = useRef<Rec | null>(null);
  const finalText = useRef("");
  const lastText = useRef("");
  const meter = useRef<{ stop: () => void } | null>(null);
  const o = useRef(opts);
  o.current = opts;

  const stopMeter = () => {
    meter.current?.stop();
    meter.current = null;
    setLevel(0);
  };

  // A live voice level for the atom (computers and Android; iPhones share the mic badly, so they skip it).
  const startMeter = async () => {
    if (isApple() || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let raf = 0;
      let smooth = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        smooth = smooth * 0.7 + Math.min(1, rms * 4) * 0.3;
        setLevel(smooth);
        raf = requestAnimationFrame(tick);
      };
      tick();
      meter.current = {
        stop: () => {
          cancelAnimationFrame(raf);
          stream.getTracks().forEach((t) => t.stop());
          ctx.close().catch(() => {});
        },
      };
    } catch {
      /* the level is only decoration */
    }
  };

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recCtor();
    if (!Ctor) return o.current.onError("Voice isn't available in this browser. Type instead, or use the mic on your keyboard.");
    unlockSpeech();
    try {
      rec.current?.abort();
    } catch {}
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    finalText.current = "";
    lastText.current = "";
    r.onstart = () => {
      setListening(true);
      startMeter();
    };
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      lastText.current = (finalText.current + interim).trim();
      o.current.onText(lastText.current);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      o.current.onError(MIC_ERRORS[e.error] ?? "Voice stopped. Try again, or type instead.");
    };
    r.onend = () => {
      setListening(false);
      stopMeter();
      rec.current = null;
      o.current.onDone((finalText.current || lastText.current).trim());
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      setListening(false);
      o.current.onError("Voice didn't start. Try again, or type instead.");
    }
  }, []);

  useEffect(
    () => () => {
      try {
        rec.current?.abort();
      } catch {}
      stopMeter();
    },
    [],
  );

  return { listening, level, start, stop };
}

// ------------------------------------------------------------------ talking

const PREFERRED = [
  /^Ava \((Premium|Enhanced)\)/i,
  /^Samantha \((Premium|Enhanced)\)/i,
  /^Zoe \((Premium|Enhanced)\)/i,
  /^Allison/i,
  /Microsoft (Ava|Aria|Jenny|Emma) Online \(Natural\)/i,
  /^Google US English/i,
  /^Samantha/i,
  /^Ava/i,
  /Microsoft (Zira|Aria|Jenny)/i,
];

let chosen: SpeechSynthesisVoice | null = null;
function pickVoice(): SpeechSynthesisVoice | null {
  if (!canSpeak()) return null;
  if (chosen) return chosen;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en[-_]US/i.test(v.lang));
  for (const re of PREFERRED) {
    const v = en.find((x) => re.test(x.name)) ?? voices.find((x) => re.test(x.name) && /^en/i.test(x.lang));
    if (v) return (chosen = v);
  }
  return (chosen = en.find((v) => v.localService) ?? en[0] ?? voices.find((v) => /^en/i.test(v.lang)) ?? null);
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    chosen = null;
    pickVoice();
  };
}

/** iPhones only let a page talk after a tap; a silent word during the tap opens the way. */
export function unlockSpeech() {
  if (!canSpeak()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {}
}

/** Markdown and source markers out, so it's read the way a person would say it. */
export function speakable(md: string): string {
  return md
    .replace(/⟦[\d,\s]+⟧/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_]([^*_]+)[*_]/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*(\d+)\.\s+/gm, "")
    .replace(/(\d)\s*bf\b/gi, "$1 board feet")
    .replace(/\bbf\/set\b/gi, "board feet per set")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1400);
}

let speakingNow = false;
export const isSpeaking = () => speakingNow;

/** Reads text out loud, a sentence at a time (long single reads cut off in some browsers). */
export function speak(text: string, on?: { start?: () => void; end?: () => void }) {
  if (!canSpeak()) return on?.end?.();
  const synth = window.speechSynthesis;
  synth.cancel();
  const clean = speakable(text);
  const parts = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((p) => p.trim()).filter(Boolean) ?? [];
  if (!parts.length) return on?.end?.();
  const voice = pickVoice();
  speakingNow = true;
  on?.start?.();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    u.rate = 1.04;
    u.pitch = 1;
    if (i === parts.length - 1) {
      u.onend = () => {
        speakingNow = false;
        on?.end?.();
      };
      u.onerror = () => {
        speakingNow = false;
        on?.end?.();
      };
    }
    synth.speak(u);
  });
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  speakingNow = false;
  window.speechSynthesis.cancel();
}
