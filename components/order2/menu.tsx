"use client";

import { useEffect, useRef } from "react";
import { Ellipsis } from "lucide-react";

/** The ⋯ button: everything you only need now and then, out of the way. Closes on a tap outside, Escape, or a pick. */
export function MoreMenu({
  children,
  label = "More",
  trigger,
  triggerClass,
}: {
  children: React.ReactNode;
  label?: string;
  /** What the button shows instead of the three dots (a picker like "Location: All"). */
  trigger?: React.ReactNode;
  triggerClass?: string;
}) {
  const box = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Opens toward whichever side has room, so a picker on the left of a phone screen isn't cut off.
  const place = () => {
    const d = box.current, p = panel.current;
    if (!d?.open || !p) return;
    p.style.left = "";
    p.style.right = "";
    p.style.maxWidth = `${Math.max(220, window.innerWidth - 24)}px`;
    const r = p.getBoundingClientRect();
    if (r.left < 12) {
      p.style.right = "auto";
      p.style.left = "0px";
      const r2 = p.getBoundingClientRect();
      if (r2.right > window.innerWidth - 12) p.style.left = `${Math.min(0, window.innerWidth - 12 - r2.right)}px`;
    }
  };
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
    <details ref={box} className="menu2" onToggle={place}>
      <summary className={triggerClass ?? "b2 quiet icon"} aria-label={label} title={label}>
        {trigger ?? <Ellipsis size={20} />}
      </summary>
      <div
        ref={panel}
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
