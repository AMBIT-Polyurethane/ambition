"use client";

// How any button reaches the AMBIT Intelligence panel: the panel lives once in the app frame and listens
// for this event, so the top-bar button, the phone's center button, the guide and Home can all open it.

export type OpenAi = { prompt?: string; listen?: boolean; send?: boolean };
const EVENT = "ambit-ai:open";

export function openAi(opts: OpenAi = {}) {
  window.dispatchEvent(new CustomEvent<OpenAi>(EVENT, { detail: opts }));
}

export function onOpenAi(fn: (o: OpenAi) => void) {
  const h = (e: Event) => fn((e as CustomEvent<OpenAi>).detail ?? {});
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** The panel tells the buttons when it's open, thinking, listening or talking, so they can match. */
const STATE = "ambit-ai:state";
export type AiState = { open: boolean; mood: "idle" | "listening" | "thinking" | "speaking" };
export function sayState(s: AiState) {
  window.dispatchEvent(new CustomEvent<AiState>(STATE, { detail: s }));
}
export function onState(fn: (s: AiState) => void) {
  const h = (e: Event) => fn((e as CustomEvent<AiState>).detail);
  window.addEventListener(STATE, h);
  return () => window.removeEventListener(STATE, h);
}
