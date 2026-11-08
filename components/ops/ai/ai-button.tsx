"use client";

import { useEffect, useRef, useState } from "react";
import { AtomOrb, type OrbMood } from "./orb";
import { onState, openAi } from "./bus";

// The pulsing AMBIT Intelligence button. Tap: the panel opens. Press and hold: it opens already
// listening, like Siri. Two places: the OPS top bar on a computer (between Schedule and Work orders) and
// the middle of the phone's bottom bar.

function useHold() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      held.current = false;
      clear();
      timer.current = setTimeout(() => {
        held.current = true;
        if (navigator.vibrate) navigator.vibrate(12);
        openAi({ listen: true });
      }, 420);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      clear();
      if (held.current) {
        held.current = false;
        return;
      }
      openAi();
    },
  };
}

function useMood(): [OrbMood, boolean] {
  const [s, setS] = useState<{ mood: OrbMood; open: boolean }>({ mood: "idle", open: false });
  useEffect(() => onState((x) => setS({ mood: x.mood, open: x.open })), []);
  return [s.mood, s.open];
}

/** In the OPS top bar (computers and tablets). */
export function AiNavButton() {
  const hold = useHold();
  const [mood, open] = useMood();
  return (
    <button type="button" className={`ops-ai-btn${open ? " open" : ""}`} aria-label="AMBIT Intelligence: ask anything (hold to talk)" title="AMBIT Intelligence: ask anything. Hold to talk." {...hold}>
      <AtomOrb size={38} mood={mood} />
      <span className="ops-ai-tip">Ask AMBIT Intelligence</span>
    </button>
  );
}

/** The middle of the phone's bottom bar, raised above it. */
export function AiTabButton() {
  const hold = useHold();
  const [mood, open] = useMood();
  return (
    <button type="button" className={`tab-ai${open ? " open" : ""}`} aria-label="AMBIT Intelligence: ask anything (hold to talk)" {...hold}>
      <AtomOrb size={60} mood={mood} />
      <span className="tab-ai-l">Ask AI</span>
    </button>
  );
}
