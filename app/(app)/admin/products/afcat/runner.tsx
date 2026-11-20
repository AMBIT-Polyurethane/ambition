"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, Wand2 } from "lucide-react";
import { brandAfcatPhotos, type BrandResult } from "./actions";

export type AfcatRow = { sku: string; name: string; afcat: string; ambit: string | null; adc: string | null };

export function AfcatPhotos({ rows }: { rows: AfcatRow[] }) {
  const router = useRouter();
  const [pick, setPick] = useState<Set<string>>(() => new Set(rows.filter((r) => !r.adc).map((r) => r.sku)));
  const [res, setRes] = useState<Record<string, BrandResult>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const todo = rows.filter((r) => pick.has(r.sku));

  const run = async () => {
    setBusy(true);
    setDone(0);
    const list = todo.map((r) => r.sku);
    for (let i = 0; i < list.length; i += 4) {
      const part = list.slice(i, i + 4);
      try {
        const out = await brandAfcatPhotos(part);
        setRes((cur) => ({ ...cur, ...Object.fromEntries(out.map((o) => [o.sku, o])) }));
      } catch (e) {
        setRes((cur) => ({ ...cur, ...Object.fromEntries(part.map((s) => [s, { sku: s, ok: false, error: (e as Error).message || "Timed out" }])) }));
      }
      setDone(Math.min(list.length, i + 4));
    }
    setBusy(false);
    setPick(new Set());
    router.refresh();
  };

  const failed = Object.values(res).filter((r) => !r.ok);
  const okN = Object.values(res).filter((r) => r.ok).length;
  const toggle = (sku: string) => setPick((cur) => { const n = new Set(cur); if (n.has(sku)) n.delete(sku); else n.add(sku); return n; });

  return (
    <div className="afp">
      <div className="card2 afp-bar">
        <span className="afp-sum">
          <b>{rows.length} items</b> have an AFCAT photo · {rows.filter((r) => r.adc).length} done · {pick.size} picked
        </span>
        <span className="afp-btns">
          <button type="button" className="b2 quiet sm" disabled={busy} onClick={() => setPick(new Set(rows.map((r) => r.sku)))}>Pick all</button>
          <button type="button" className="b2 quiet sm" disabled={busy} onClick={() => setPick(new Set())}>Clear</button>
          {failed.length ? <button type="button" className="b2 quiet sm" disabled={busy} onClick={() => setPick(new Set(failed.map((f) => f.sku)))}>Pick the {failed.length} that failed</button> : null}
          <button type="button" className="b2" disabled={busy || !pick.size} onClick={run}>
            {busy ? <><LoaderCircle size={17} className="spin" /> {done} of {todo.length}</> : <><Wand2 size={17} /> Brand and save {pick.size} photo{pick.size === 1 ? "" : "s"}</>}
          </button>
        </span>
        {busy ? <span className="prd-bar afp-prog" aria-hidden="true"><span style={{ width: `${todo.length ? Math.round((done / todo.length) * 100) : 0}%` }} /></span> : null}
        {!busy && (okN || failed.length) ? (
          <span className={`small ${failed.length ? "red" : ""}`}>{okN} saved{failed.length ? ` · ${failed.length} didn't work (see the red ones below)` : ""}</span>
        ) : null}
      </div>
      <div className="afp-grid">
        {rows.map((r) => {
          const x = res[r.sku];
          const adc = x?.ok ? x.adc : r.adc;
          return (
            <label key={r.sku} className={`card2 afp-item${pick.has(r.sku) ? " on" : ""}${x && !x.ok ? " bad" : ""}`}>
              <input type="checkbox" checked={pick.has(r.sku)} onChange={() => toggle(r.sku)} disabled={busy} />
              <span className="afp-ph">
                <img src={r.afcat} alt="" loading="lazy" />
                <ArrowRight size={16} aria-hidden="true" className="afp-arrow" />
                {adc ? <img src={adc} alt="" loading="lazy" /> : <span className="afp-none">Not made yet</span>}
              </span>
              <span className="afp-b">
                <b>{r.sku}</b>
                <span>{r.name}</span>
                {x && !x.ok ? <span className="afp-err"><CircleAlert size={14} aria-hidden="true" /> {x.error}</span> : x?.ok ? <span className="afp-ok"><CircleCheck size={14} aria-hidden="true" /> Saved</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
