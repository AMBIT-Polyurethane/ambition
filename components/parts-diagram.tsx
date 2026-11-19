"use client";

import { useMemo, useState } from "react";
import { Check, Minus, Plus, Search, ShoppingCart } from "lucide-react";
import { PART_GROUPS, type Diagram, type DiagramPart, type PartGroup } from "@/lib/diagrams";

/** What the store knows about a part: its price (or none), and whether it can go on an order. */
export type PartInfo = { id: string | null; price: number | null; sale: number | null; quote: boolean };

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * The exploded view: a colored dot on every part, a box on every table row. Hover (or tap) one to see the part number and
 * price; click to add it to the cart. The list beside it does the same, and the colors filter by area of the gun.
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
  /** ADC store: parts not in the catalog still go on the order, price to confirm. The app: ask AMBIT. */
  canAddMissing: boolean;
  theme?: "light" | "dark";
}) {
  const [hot, setHot] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [only, setOnly] = useState<PartGroup | null>(null);
  const [zoom, setZoom] = useState(1);
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Record<string, number>>({});
  const focus = hot ?? pinned;

  // One row per part number (some show in the drawing more than once).
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
  const tipFor = focus ? diagram.parts.find((p) => p.sku === focus) : null;
  const tipAt = tipFor?.at?.[0] ?? (tipFor?.box?.[0] ? [tipFor.box[0][0] + tipFor.box[0][2] / 2, tipFor.box[0][1]] : null);

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
        <span className="pd-zoom" role="group" aria-label="Zoom the drawing">
          <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out"><Minus size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(2.5, z + 0.5))} disabled={zoom >= 2.5} aria-label="Zoom in"><Plus size={16} /></button>
        </span>
      </div>

      <div className="pd-body">
        <div className="pd-stage" onMouseLeave={() => setHot(null)}>
          <div className="pd-canvas" style={{ width: `${zoom * 100}%` }}>
            <img src={diagram.image} alt={diagram.source} width={diagram.w} height={diagram.h} draggable={false} />
            {diagram.parts.flatMap((p, i) => {
              const dim = only && p.group !== only;
              const on = focus === p.sku;
              const color = PART_GROUPS[p.group].color;
              const label = `${p.n ? `Item ${p.n}, ` : ""}${p.name}, part ${p.sku}, ${priceText(p.sku)}`;
              const common = {
                onMouseEnter: () => setHot(p.sku),
                onFocus: () => setHot(p.sku),
                onBlur: () => setHot(null),
                onClick: () => {
                  setPinned(p.sku);
                  add(p);
                },
                "aria-label": addable(p.sku) ? `Add ${label}` : label,
              };
              return [
                ...(p.at ?? []).map(([x, y], k) => (
                  <button
                    key={`d${i}-${k}`}
                    type="button"
                    className={`pd-dot${on ? " on" : ""}${dim ? " dim" : ""}${info[p.sku] ? "" : " missing"}`}
                    style={{ left: `${(x / diagram.w) * 100}%`, top: `${(y / diagram.h) * 100}%`, ["--c" as string]: color }}
                    {...common}
                  >
                    {added[p.sku] ? <Check size={11} strokeWidth={3} /> : p.n || "+"}
                  </button>
                )),
                ...(p.box ?? []).map(([x, y, w, h], k) => (
                  <button
                    key={`b${i}-${k}`}
                    type="button"
                    className={`pd-box${on ? " on" : ""}${dim ? " dim" : ""}`}
                    style={{ left: `${(x / diagram.w) * 100}%`, top: `${(y / diagram.h) * 100}%`, width: `${(w / diagram.w) * 100}%`, height: `${(h / diagram.h) * 100}%`, ["--c" as string]: color }}
                    {...common}
                  />
                )),
              ];
            })}
            {tipFor && tipAt ? (
              <div
                className={`pd-tip${tipAt[1] / diagram.h < 0.25 ? " below" : ""}`}
                style={{ left: `${Math.min(88, Math.max(12, (tipAt[0] / diagram.w) * 100))}%`, top: `${(tipAt[1] / diagram.h) * 100}%` }}
                role="status"
              >
                <span className="pd-tip-h">
                  <span className="pd-sw" style={{ background: PART_GROUPS[tipFor.group].color }} aria-hidden="true" />
                  {tipFor.n ? `#${tipFor.n} · ` : ""}Part {tipFor.sku}
                </span>
                <b>{tipFor.name}</b>
                <span className="pd-tip-p">{priceText(tipFor.sku)}</span>
                <span className="pd-tip-a">{added[tipFor.sku] ? "Added to your cart" : addable(tipFor.sku) ? "Click to add to cart" : "Not in our catalog yet. Ask AMBIT."}</span>
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
                className={focus === p.sku ? "on" : undefined}
                onMouseEnter={() => setHot(p.sku)}
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
                    setPinned(p.sku);
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
      <p className="pd-src">Drawing: {diagram.source}. Dots with a dashed ring aren&apos;t in the catalog yet{canAddMissing ? "; they go on your order and we confirm the price" : ""}.</p>
    </div>
  );
}
