"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

/** The open pipeline stages: rename, reorder, add, remove (Won and Lost stay at the end). */
export function StageRows({ stages }: { stages: { key: string; name: string }[] }) {
  const [rows, setRows] = useState(stages.map((s, i) => ({ ...s, id: `${s.key}-${i}` })));
  const move = (i: number, d: number) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  return (
    <div className="col" style={{ gap: 8 }}>
      {rows.map((r, i) => (
        <div key={r.id} className="ops-row-edit">
          <span className="ops-row-n">{i + 1}</span>
          <input type="hidden" name="stage_key" value={r.key} />
          <input className="input sm" name="stage_name" defaultValue={r.name} maxLength={40} aria-label={`Stage ${i + 1}`} required />
          <button type="button" className="iconbtn sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={15} /></button>
          <button type="button" className="iconbtn sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}><ArrowDown size={15} /></button>
          <button type="button" className="iconbtn sm" aria-label="Remove stage" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} disabled={rows.length <= 1}><X size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setRows((x) => [...x, { key: "", name: "", id: `new-${Date.now()}` }])}>
        <Plus size={15} /> Add a stage
      </button>
    </div>
  );
}

/** Work areas: a short code (EW) and a name (Exterior walls). */
export function AreaRows({ areas }: { areas: { code: string; name: string }[] }) {
  const [rows, setRows] = useState(areas.map((a, i) => ({ ...a, id: `${a.code}-${i}` })));
  return (
    <div className="col" style={{ gap: 8 }}>
      {rows.map((r, i) => (
        <div key={r.id} className="ops-row-edit area">
          <input className="input sm" name="area_code" defaultValue={r.code} maxLength={4} aria-label="Code" style={{ textTransform: "uppercase" }} />
          <input className="input sm" name="area_name" defaultValue={r.name} maxLength={40} aria-label="Work area" />
          <button type="button" className="iconbtn sm" aria-label="Remove work area" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><X size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setRows((x) => [...x, { code: "", name: "", id: `new-${Date.now()}` }])}>
        <Plus size={15} /> Add a work area
      </button>
    </div>
  );
}
