"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, GripVertical, LayoutGrid, LoaderCircle, RotateCcw } from "lucide-react";
import { saveHomeLayout } from "@/app/(app)/home-actions";
import { WIDE_CARDS, type HomeLayout } from "@/lib/home-board";

// The Home board: every card on Home, laid out like a masonry wall on a computer (each card tucks up under the one
// above it, so there are no gaps) and in one column on a phone. "Customize" lets each person drag cards into the
// order they want (press and hold on a phone, click and drag on a computer) and hide the ones they don't use.

export type BoardItem = { key: string; title: string; node: React.ReactNode };

const ROW = 8; // px per grid row on a computer
const GAP = 14; // px between cards

type Press = { key: string; x: number; y: number; touch: boolean; timer: number | null; started: boolean };

export function HomeBoard({ items, defaults, initial }: { items: BoardItem[]; defaults: string[]; initial: HomeLayout }) {
  const router = useRouter();
  const [order, setOrder] = useState<string[]>(initial.order);
  const [hidden, setHidden] = useState<string[]>(initial.hidden);
  const [editing, setEditing] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [error, setError] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const orderRef = useRef(order);
  const hiddenRef = useRef(hidden);
  const last = useRef({ x: 0, y: 0 });
  const scrollRaf = useRef(0);
  orderRef.current = order;
  hiddenRef.current = hidden;
  const byKey = new Map(items.map((i) => [i.key, i]));

  // Server layout changed (another device, Reset): take it.
  useEffect(() => {
    setOrder(initial.order);
    setHidden(initial.hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.order.join(","), initial.hidden.join(",")]);

  // "Customize" in the Home header opens this.
  useEffect(() => {
    const open = () => setEditing(true);
    window.addEventListener("home:customize", open);
    return () => window.removeEventListener("home:customize", open);
  }, []);

  // Masonry on a computer: each card spans as many 8px rows as it is tall, so the next card tucks right under it.
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let raf = 0;
    const layout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cols = getComputedStyle(board).gridTemplateColumns.split(" ").filter(Boolean).length;
        const masonry = cols > 1;
        if (masonry) board.dataset.masonry = "1";
        else delete board.dataset.masonry;
        board.querySelectorAll<HTMLElement>(":scope > .slot").forEach((slot) => {
          const inner = slot.firstElementChild as HTMLElement | null;
          if (!masonry || !inner) {
            slot.style.gridRowEnd = "";
            return;
          }
          const h = inner.getBoundingClientRect().height;
          slot.style.gridRowEnd = `span ${Math.max(1, Math.ceil((h + (h > 0 ? GAP : 0)) / ROW))}`;
        });
      });
    };
    const ro = new ResizeObserver(layout);
    ro.observe(board);
    board.querySelectorAll(":scope > .slot > .slot-in").forEach((el) => ro.observe(el));
    layout();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [order, hidden, editing]);

  const persist = useCallback(async (o: string[], h: string[]) => {
    setStatus("saving");
    setError(null);
    const r = await saveHomeLayout({ order: o, hidden: h }).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection." }));
    if (r.ok) setStatus("saved");
    else {
      setStatus("error");
      setError(r.error);
    }
  }, []);

  // ---------------------------------------------------------------- dragging
  const placeGhost = (x: number, y: number) => {
    const g = ghostRef.current;
    if (!g) return;
    // keep it on screen: the grip under the finger, the card never past the edges
    const left = Math.max(8, Math.min(x - 28, window.innerWidth - g.offsetWidth - 8));
    g.style.transform = `translate(${Math.round(left)}px, ${Math.round(y - 26)}px)`;
  };

  const retarget = (x: number, y: number) => {
    const key = press.current?.key;
    if (!key) return;
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot]");
    const target = el?.dataset.slot;
    if (!el || !target || target === key) return;
    const r = el.getBoundingClientRect();
    const after = y > r.top + r.height / 2;
    const cur = orderRef.current;
    const without = cur.filter((k) => k !== key);
    const i = without.indexOf(target);
    if (i < 0) return;
    without.splice(after ? i + 1 : i, 0, key);
    if (without.join(",") !== cur.join(",")) setOrder(without);
  };

  const autoScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    const step = () => {
      if (!press.current?.started) return;
      const { x, y } = last.current;
      const bottom = window.innerHeight - (window.innerWidth >= 1024 ? 40 : 130);
      const dy = y < 90 ? -Math.ceil((90 - y) / 6) : y > bottom ? Math.ceil((y - bottom) / 6) : 0;
      if (dy) {
        window.scrollBy(0, dy);
        retarget(x, y);
      }
      scrollRaf.current = requestAnimationFrame(step);
    };
    scrollRaf.current = requestAnimationFrame(step);
  };

  const begin = (x: number, y: number) => {
    const p = press.current;
    if (!p) return;
    p.started = true;
    setDragKey(p.key);
    placeGhost(x, y);
    try {
      navigator.vibrate?.(10);
    } catch {
      // not on this phone
    }
    autoScroll();
  };

  const finish = () => {
    const p = press.current;
    press.current = null;
    cancelAnimationFrame(scrollRaf.current);
    if (p?.timer) window.clearTimeout(p.timer);
    if (p?.started) {
      setDragKey(null);
      void persist(orderRef.current, hiddenRef.current);
    }
  };

  // Mouse: click on a card and drag.
  const onMouseDown = (e: React.MouseEvent, key: string) => {
    if (!editing || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    press.current = { key, x: e.clientX, y: e.clientY, touch: false, timer: null, started: false };
    const move = (ev: MouseEvent) => {
      const p = press.current;
      if (!p) return;
      last.current = { x: ev.clientX, y: ev.clientY };
      if (!p.started) {
        if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 4) begin(ev.clientX, ev.clientY);
        return;
      }
      placeGhost(ev.clientX, ev.clientY);
      retarget(ev.clientX, ev.clientY);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      finish();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Touch: press and hold a card (a moment), then drag. A quick swipe still scrolls the page.
  const onTouchStart = (e: React.TouchEvent, key: string, handle = false) => {
    if (!editing || e.touches.length !== 1 || (e.target as HTMLElement).closest("button")) return;
    const t = e.touches[0];
    last.current = { x: t.clientX, y: t.clientY };
    const p: Press = { key, x: t.clientX, y: t.clientY, touch: true, timer: null, started: false };
    press.current = p;
    p.timer = window.setTimeout(() => begin(last.current.x, last.current.y), handle ? 0 : 220);
    const move = (ev: TouchEvent) => {
      const cur = press.current;
      if (!cur) return;
      const tt = ev.touches[0];
      last.current = { x: tt.clientX, y: tt.clientY };
      if (!cur.started) {
        if (Math.hypot(tt.clientX - cur.x, tt.clientY - cur.y) > 10) end(); // they're scrolling
        return;
      }
      ev.preventDefault(); // dragging, not scrolling
      placeGhost(tt.clientX, tt.clientY);
      retarget(tt.clientX, tt.clientY);
    };
    const end = () => {
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      finish();
    };
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
  };

  // The ghost appears once dragging starts: put it under the finger / pointer straight away.
  useLayoutEffect(() => {
    if (dragKey) placeGhost(last.current.x, last.current.y);
  }, [dragKey]);

  // ---------------------------------------------------------------- buttons
  const move = (key: string, by: number) => {
    const cur = [...orderRef.current];
    const i = cur.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setOrder(cur);
    void persist(cur, hiddenRef.current);
  };
  const toggle = (key: string) => {
    const next = hiddenRef.current.includes(key) ? hiddenRef.current.filter((k) => k !== key) : [...hiddenRef.current, key];
    setHidden(next);
    void persist(orderRef.current, next);
  };
  const reset = async () => {
    setOrder(defaults);
    setHidden([]);
    await persist(defaults, []);
    router.refresh();
  };
  const done = () => {
    setEditing(false);
    setStatus("");
    // A card that was hidden when the page loaded has nothing to show until Home reloads it.
    if (order.some((k) => !hidden.includes(k) && byKey.get(k) && byKey.get(k)!.node == null)) router.refresh();
  };

  const visible = order.filter((k) => byKey.has(k) && (editing || !hidden.includes(k)));
  const dragging = dragKey ? byKey.get(dragKey) : null;

  return (
    <>
      <div ref={boardRef} className={`board${editing ? " editing" : ""}${dragKey ? " is-dragging" : ""}`} aria-label="Home">
        {visible.map((key, i) => {
          const it = byKey.get(key)!;
          const off = hidden.includes(key);
          return (
            <div
              key={key}
              data-slot={key}
              className={`slot${WIDE_CARDS.has(key) ? " wide" : ""}${dragKey === key ? " dragging" : ""}${off ? " off" : ""}`}
              onMouseDown={editing ? (e) => onMouseDown(e, key) : undefined}
              onTouchStart={editing ? (e) => onTouchStart(e, key) : undefined}
            >
              <div className="slot-in">
                {editing ? (
                  <div className="slot-bar">
                    <span className="slot-grip" onTouchStart={(e) => { e.stopPropagation(); onTouchStart(e, key, true); }} aria-hidden="true">
                      <GripVertical size={18} />
                    </span>
                    <b className="grow ellipsis">{it.title}</b>
                    <button type="button" className="iconbtn sm" aria-label={`Move ${it.title} up`} disabled={i === 0} onClick={() => move(key, -1)}>
                      <ArrowUp size={16} />
                    </button>
                    <button type="button" className="iconbtn sm" aria-label={`Move ${it.title} down`} disabled={i === visible.length - 1} onClick={() => move(key, 1)}>
                      <ArrowDown size={16} />
                    </button>
                    <button type="button" className={`iconbtn sm${off ? " eye-off" : ""}`} aria-label={off ? `Show ${it.title}` : `Hide ${it.title}`} aria-pressed={off} onClick={() => toggle(key)}>
                      {off ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                ) : null}
                <div className="slot-body">{off ? (editing ? <div className="slot-hidden small muted">Hidden. Tap the eye to show it again.</div> : null) : it.node}</div>
              </div>
            </div>
          );
        })}
      </div>

      {editing ? (
        <div className="board-bar" role="region" aria-label="Customize Home">
          <span className="small grow">
            <b>Customize Home.</b> <span className="muted">Hold and drag a card (or use the arrows) to move it. The eye hides it.</span>
            {status === "saving" ? <span className="faint"> Saving…</span> : status === "saved" ? <span className="faint"> Saved.</span> : null}
            {error ? <span style={{ color: "var(--err-text)" }}> {error}</span> : null}
          </span>
          <button type="button" className="btn sm dark" onClick={reset} style={{ gap: 6 }}>
            {status === "saving" ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />} Reset
          </button>
          <button type="button" className="btn sm" onClick={done} style={{ gap: 6 }}>
            <Check size={16} /> Done
          </button>
        </div>
      ) : (
        <button type="button" className="board-customize" onClick={() => setEditing(true)}>
          <LayoutGrid size={16} /> Customize Home
        </button>
      )}

      {dragging ? (
        <div ref={ghostRef} className="board-ghost" aria-hidden="true">
          <GripVertical size={18} /> <b className="ellipsis">{dragging.title}</b>
        </div>
      ) : null}
    </>
  );
}

/** The Customize button in the Home header. */
export function CustomizeButton() {
  return (
    <button type="button" className="iconbtn" aria-label="Customize Home" title="Customize Home" onClick={() => window.dispatchEvent(new Event("home:customize"))}>
      <LayoutGrid size={19} />
    </button>
  );
}
