"use client";

import { useEffect, useRef } from "react";
import { Ellipsis } from "lucide-react";

/** The ⋯ button: everything you only need now and then, out of the way. Closes on a tap outside, Escape, or a pick. */
export function MoreMenu({ children, label = "More" }: { children: React.ReactNode; label?: string }) {
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => {
      const d = box.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && box.current) box.current.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  return (
    <details ref={box} className="menu2">
      <summary className="b2 quiet icon" aria-label={label} title={label}>
        <Ellipsis size={20} />
      </summary>
      <div
        className="menu2-p"
        role="menu"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a") && box.current) box.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
