"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, Minus, Plus, Search, ShoppingCart } from "lucide-react";
import { PART_GROUPS, type Diagram, type DiagramPart, type PartGroup } from "@/lib/diagrams";

/** What the store knows about a part: its price (or none), and whether it can go on an order. */
export type PartInfo = { id: string | null; price: number | null; sale: number | null; quote: boolean };

/** One entry on the drawing: a part can be drawn under more than one item number (a housing that only comes in its assembly). */
const pk = (p: DiagramPart) => `${p.sku}#${p.n}`;
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The box around an SVG path ("M x y L x y ... Z"), in drawing pixels. */
function boxOf(d: string): [number, number, number, number] {
  const n = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
    y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
  }
  return [x0, y0, x1, y1];
}

/**
 * The exploded view. Nothing covers the drawing: move over a part and the part itself lights up in its color, with its
 * number and price. Click it to add it to the cart (on a phone: tap to see it, tap Add). The rows in the drawing's own
 * tables work the same way. The colored buttons tint one area of the gun; "Show all parts" tints every part you can buy.
 */
export function PartsDiagram({
  diagram,
  info,
  onAdd,
  canAddMissing,
  theme = "light",
}: {
  diagram: Diagram;
  info: Record<string, PartInfo | undefined>;
  onAdd: (part: DiagramPart, info: PartInfo | undefined) => void;
  /** ADC store: parts not in the catalog yet still go on the order, price to confirm. The app: ask AMBIT. */
  canAddMissing: boolean;
  theme?: "light" | "dark";
}) {
  const [hot, setHot] = useState<{ key: string; k: number } | null>(null);
  const [pinned, setPinned] = useState<{ key: string; k: number } | null>(null);
  const [only, setOnly] = useState<PartGroup | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [hint, setHint] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Record<string, number>>({});
  const touch = useRef(false);
  const focus = hot ?? pinned;

  // A soft flash of every part when the drawing first shows, so people see the parts are live.
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 2600);
    return () => clearTimeout(t);
  }, []);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return diagram.parts.filter((p) => (seen.has(p.sku) ? false : (seen.add(p.sku), true)));
  }, [diagram]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const listed = rows.filter((p) => (!only || p.group === only) && words.every((w) => `${p.n} ${p.sku} ${p.name}`.toLowerCase().includes(w)));
  const groups = (Object.keys(PART_GROUPS) as PartGroup[]).filter((g) => rows.some((p) => p.group === g));

  const priceText = (sku: string) => {
    const i = info[sku];
    if (!i) return canAddMissing ? "Price to confirm" : "Ask AMBIT";
    if (i.quote || i.price === null) return "Request a quote";
    return usd(i.sale ?? i.price);
  };
  const addable = (sku: string) => Boolean(info[sku]) || canAddMissing;
  const add = (p: DiagramPart) => {
    if (!addable(p.sku)) return;
    onAdd(p, info[p.sku]);
    setAdded((m) => ({ ...m, [p.sku]: (m[p.sku] ?? 0) + 1 }));
    setTimeout(() => setAdded((m) => ({ ...m, [p.sku]: Math.max(0, (m[p.sku] ?? 1) - 1) })), 1600);
  };
  // Mouse: a click adds it. Touch: the first tap shows it, a second tap (or Add) adds it.
  const choose = (p: DiagramPart, k: number) => {
    if (touch.current && (pinned?.key !== pk(p))) {
      setPinned({ key: pk(p), k });
      return;
    }
    setPinned({ key: pk(p), k });
    add(p);
  };

  // Where the tip goes: over the part copy being pointed at (or its table row).
  const tipPart = focus ? diagram.parts.find((p) => pk(p) === focus.key) : null;
  const tipBox = (() => {
    if (!tipPart || !focus) return null;
    const d = tipPart.shapes?.[focus.k] ?? tipPart.shapes?.[0];
    if (d) return boxOf(d);
    const b = tipPart.box?.[0];
    if (b) return [b[0], b[1], b[0] + b[2], b[1] + b[3]] as [number, number, number, number];
    const a = tipPart.at?.[focus.k] ?? tipPart.at?.[0];
    return a ? ([a[0] - 10, a[1] - 10, a[0] + 10, a[1] + 10] as [number, number, number, number]) : null;
  })();
  const below = tipBox ? tipBox[1] / diagram.h < 0.26 : false;

  const partProps = (p: DiagramPart, k: number, label: string) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-label": addable(p.sku) ? `Add ${label}` : label,
    onMouseEnter: () => setHot({ key: pk(p), k }),
    onMouseLeave: () => setHot(null),
    onFocus: () => setHot({ key: pk(p), k }),
    onBlur: () => setHot(null),
    onPointerDown: (e: React.PointerEvent) => {
      touch.current = e.pointerType === "touch" || e.pointerType === "pen";
    },
    onClick: () => choose(p, k),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        touch.current = false;
        choose(p, k);
      }
    },
  });

  return (
    <div className={`pd ${theme}`}>
      <div className="pd-legend" role="group" aria-label="Show one area of the gun">
        <button type="button" className={!only ? "on" : undefined} onClick={() => setOnly(null)}>Every part</button>
        {groups.map((g) => (
          <button key={g} type="button" className={only === g ? "on" : undefined} onClick={() => setOnly(only === g ? null : g)}>
            <span className="pd-sw" style={{ background: PART_GROUPS[g].color }} aria-hidden="true" />
            {PART_GROUPS[g].label}
          </button>
        ))}
        <button type="button" className={showAll ? "on" : undefined} onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
          {showAll ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />} {showAll ? "Hide part colors" : "Show all parts"}
        </button>
        <span className="pd-zoom" role="group" aria-label="Zoom the drawing">
          <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out"><Minus size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(2.5, z + 0.5))} disabled={zoom >= 2.5} aria-label="Zoom in"><Plus size={16} /></button>
        </span>
      </div>

      <div className="pd-body">
        <div className="pd-stage" onMouseLeave={() => setHot(null)}>
          <div className={`pd-canvas${hint ? " hint" : ""}${showAll ? " all" : ""}${only ? " group" : ""}`} style={{ width: `${zoom * 100}%` }}>
            <img src={diagram.image} alt={diagram.source} width={diagram.w} height={diagram.h} draggable={false} />
            <svg className="pd-svg" viewBox={`0 0 ${diagram.w} ${diagram.h}`} preserveAspectRatio="none" aria-label="Parts on the drawing">
              {diagram.parts.flatMap((p, i) => {
                const color = PART_GROUPS[p.group].color;
                const label = `${p.n ? `Item ${p.n}, ` : ""}${p.name}, part ${p.sku}, ${priceText(p.sku)}`;
                const state = `${focus?.key === pk(p) ? " on" : ""}${only === p.group ? " tint" : ""}${addable(p.sku) ? "" : " off"}`;
                const style = { ["--c" as string]: color } as React.CSSProperties;
                const els: React.ReactNode[] = [];
                // The part's own outline (every copy in the drawing).
                (p.shapes ?? []).forEach((d, k) => {
                  els.push(<path key={`s${i}-${k}`} d={d} className={`pd-part${state}`} style={style} {...partProps(p, k, label)} />);
                });
                // No outline traced: an invisible spot where it's drawn.
                if (!p.shapes?.length) {
                  (p.at ?? []).forEach(([x, y], k) => {
                    els.push(<circle key={`c${i}-${k}`} cx={x} cy={y} r={11} className={`pd-part spot${state}`} style={style} {...partProps(p, k, label)} />);
                  });
                }
                // Rows in the drawing's own tables.
                (p.box ?? []).forEach(([x, y, w, h], k) => {
                  els.push(<rect key={`b${i}-${k}`} x={x} y={y} width={w} height={h} rx={2} className={`pd-part row${state}`} style={style} {...partProps(p, 100 + k, label)} />);
                });
                return els;
              })}
            </svg>
            {tipPart && tipBox ? (
              <div
                className={`pd-tip${below ? " below" : ""}${pinned && touch.current && pinned.key === pk(tipPart) ? " live" : ""}`}
                style={{
                  left: `${Math.min(88, Math.max(12, (((tipBox[0] + tipBox[2]) / 2) / diagram.w) * 100))}%`,
                  top: `${((below ? tipBox[3] : tipBox[1]) / diagram.h) * 100}%`,
                }}
                role="status"
              >
                <span className="pd-tip-h">
                  <span className="pd-sw" style={{ background: PART_GROUPS[tipPart.group].color }} aria-hidden="true" />
                  {tipPart.n ? `#${tipPart.n} · ` : ""}Part {tipPart.sku}
                </span>
                <b>{tipPart.name}</b>
                {tipPart.note ? <span className="pd-tip-note">{tipPart.note}</span> : null}
                <span className="pd-tip-p">{priceText(tipPart.sku)}</span>
                {pinned && touch.current && pinned.key === pk(tipPart) && addable(tipPart.sku) ? (
                  <button type="button" className="pd-tip-add" onClick={() => add(tipPart)}>
                    {added[tipPart.sku] ? <><Check size={15} strokeWidth={3} /> Added</> : <><ShoppingCart size={15} /> Add to cart</>}
                  </button>
                ) : (
                  <span className="pd-tip-a">{added[tipPart.sku] ? "Added to your cart" : addable(tipPart.sku) ? "Click to add to cart" : "Not in our catalog yet. Ask AMBIT."}</span>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="pd-side">
          <label className="pd-find">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part name, number or #" aria-label="Find a part" />
          </label>
          <ul className="pd-list">
            {listed.map((p) => (
              <li
                key={p.sku}
                className={focus && diagram.parts.find((x) => pk(x) === focus.key)?.sku === p.sku ? "on" : undefined}
                onMouseEnter={() => setHot({ key: pk(p), k: 0 })}
                onMouseLeave={() => setHot(null)}
              >
                <span className="pd-n" style={{ background: PART_GROUPS[p.group].color }}>{p.n || "·"}</span>
                <span className="pd-li">
                  <b>{p.name}</b>
                  <span>{p.sku}{p.qty ? ` · ${p.qty}` : ""} · {priceText(p.sku)}</span>
                </span>
                <button
                  type="button"
                  className="pd-add"
                  disabled={!addable(p.sku)}
                  onClick={() => {
                    setPinned({ key: pk(p), k: 0 });
                    add(p);
                  }}
                  aria-label={addable(p.sku) ? `Add ${p.name} (${p.sku}) to the cart` : `${p.name} isn't in the catalog yet`}
                >
                  {added[p.sku] ? <Check size={16} strokeWidth={3} /> : <ShoppingCart size={16} />}
                </button>
              </li>
            ))}
            {!listed.length ? <li className="pd-none">No part matches.</li> : null}
          </ul>
        </div>
      </div>
      <p className="pd-src">Drawing: {diagram.source}. Point at any part to see it light up; click to add it to your cart.</p>
    </div>
  );
}
