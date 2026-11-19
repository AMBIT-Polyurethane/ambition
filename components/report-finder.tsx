"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { TileCard, type Tile } from "@/components/tile-grid";

/** Reports page: every report as a tile, by area, with a box that narrows them as you type. */
export function ReportFinder({ groups }: { groups: { key: string; label: string; tiles: Tile[] }[] }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (t: Tile) => words.every((w) => `${t.title} ${t.sub ?? ""}`.toLowerCase().includes(w));
  const shown = groups.map((g) => ({ ...g, tiles: g.tiles.filter(hit) })).filter((g) => g.tiles.length);
  return (
    <>
      <label className="stk-search rpt-find">
        <Search size={18} aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report: lot, sales, payments..." aria-label="Find a report" />
      </label>
      {shown.map((g) => (
        <section key={g.key} className="tg-sec" aria-label={g.label}>
          <b className="tg-h">{g.label}</b>
          <div className="tg-grid">{g.tiles.map((t) => <TileCard key={t.key} t={t} />)}</div>
        </section>
      ))}
      {!shown.length ? <p className="muted" style={{ margin: 0 }}>No report matches &ldquo;{q}&rdquo;.</p> : null}
    </>
  );
}
