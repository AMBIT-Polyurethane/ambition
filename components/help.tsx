"use client";

import { useEffect, useRef, useState } from "react";

/** A small "?" that opens a short tip, instead of a paragraph on the page. Tap again, or anywhere else, to close. */
export function Help({ children, label = "More about this" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={box} className="help">
      <button
        type="button"
        className="help-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          // Works inside a link or a fold-out row too: the tap opens the tip, nothing else.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open ? (
        <span
          role="note"
          className="help-tip"
          onClick={(e) => {
            e.stopPropagation();
            if (!(e.target as HTMLElement).closest("a")) e.preventDefault();
          }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
