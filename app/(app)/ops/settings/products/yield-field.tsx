"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";

/**
 * Board feet per set. Changing it from the starting number shows a caution (and asks them to confirm),
 * because a yield set too high underprices every foam job and hides waste.
 */
export function YieldField({ value, standard }: { value: number | null; standard: number | null }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  const n = Number(v.replace(/[,\s]/g, ""));
  const changed = v !== "" && Number.isFinite(n) && n !== (value ?? standard ?? n);
  const off = standard !== null && v !== "" && Number.isFinite(n) && n !== standard;
  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="field">
        <span className="label">Yield (board feet per set)</span>
        <input className="input sm" name="yield_bf" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} placeholder={standard ? String(standard) : "Board feet"} />
      </label>
      {changed || off ? (
        <div className="alert warn small" role="alert" style={{ flexDirection: "column", gap: 6 }}>
          <span><TriangleAlert size={15} style={{ verticalAlign: -3 }} /> Caution is advised when setting expected yields. {standard ? `AMBIT's starting number is ${standard.toLocaleString()} board feet per set.` : ""} A yield set too high makes every foam quote too cheap and hides waste on the job.</span>
          {changed ? <label className="check small"><input type="checkbox" required /> I understand. Use {Number.isFinite(n) ? n.toLocaleString() : v} board feet per set.</label> : null}
        </div>
      ) : null}
    </div>
  );
}
