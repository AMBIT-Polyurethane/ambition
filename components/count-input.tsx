"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, CircleCheck, LoaderCircle, Search } from "lucide-react";
import { saveCountLine } from "@/app/(app)/inventory/count-actions";
import { plural } from "@/lib/format";

type Line = { id: number; sku: string; name: string | null; unit: string | null; lot_no: string | null; counted_qty: number | null };

const fmt = (n: number | null) => (n === null ? "" : String(Number(n)));
const unitWord = (u: string | null, n = 2) => (u ? plural(u, n) : "");

/**
 * A spot check: count the item on the shelf (spray foam lot by lot) and save. The app's number isn't shown, so the
 * count is a real one. A count that matches is done; one that doesn't goes to an admin to approve.
 */
export function SpotCheckForm({ lines, day, label }: { lines: Line[]; day: string; label?: string }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.id, fmt(l.counted_qty)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const first = lines[0];
  const lots = lines.length > 1 || Boolean(first?.lot_no);

  const save = async () => {
    setError(null);
    const bad = lines.find((l) => !/^\d+(\.\d{1,2})?$/.test((vals[l.id] ?? "").trim()));
    if (bad) return setError(lots ? `Type a count for lot ${bad.lot_no ?? "(no lot #)"} (0 if there are none).` : "Type the count (0 if there are none).");
    setBusy(true);
    let status = "open";
    for (const l of lines) {
      const r = await saveCountLine(l.id, Number(vals[l.id]));
      if (!r.ok) {
        setBusy(false);
        return setError(r.error);
      }
      status = r.status;
    }
    setBusy(false);
    setResult(status);
    router.refresh();
  };

  if (result === "matched" || result === "submitted") {
    return result === "matched" ? (
      <div className="spot-done ok" role="status">
        <CircleCheck size={18} /> Matches what the app has. Thanks!
      </div>
    ) : (
      <div className="spot-done warn" role="status">
        <CircleAlert size={18} /> Doesn&apos;t match the app. It&apos;s gone to an admin to approve.
      </div>
    );
  }

  return (
    <div className="spot-form">
      <div className="spot-item">
        <b>{first?.name ?? first?.sku}</b>
        <span className="tiny faint">{first?.sku}{label ? ` · ${label}` : ""} · {day}</span>
      </div>
      <div className="spot-lines">
        {lines.map((l) => (
          <label key={l.id} className="spot-line">
            <span className="small">{lots ? `Lot ${l.lot_no ?? "(no lot #)"}` : `How many ${unitWord(l.unit)} on the shelf?`}</span>
            <input
              className="input sm"
              inputMode="decimal"
              value={vals[l.id] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [l.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="Count"
              aria-label={lots ? `Count for lot ${l.lot_no ?? "(no lot #)"}` : "Count"}
            />
          </label>
        ))}
      </div>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="button" className="btn sm" onClick={save} disabled={busy} style={{ alignSelf: "flex-start", gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} {busy ? "Saving…" : "Save count"}
      </button>
    </div>
  );
}

type SheetLine = Line & { group?: string | null };

/** The quarterly reconciliation: every item, saved as you go (nothing is lost if you stop and come back). */
export function CountSheet({ lines, countId }: { lines: SheetLine[]; countId: number }) {
  const [vals, setVals] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.id, fmt(l.counted_qty)])));
  const [saved, setSaved] = useState<Record<number, "ok" | "busy" | string>>(() => Object.fromEntries(lines.filter((l) => l.counted_qty !== null).map((l) => [l.id, "ok"])));
  const [q, setQ] = useState("");
  const [todo, setTodo] = useState(false);
  const counted = Object.values(saved).filter((v) => v === "ok").length;
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      lines.filter(
        (l) =>
          (!todo || saved[l.id] !== "ok") &&
          (!needle || `${l.sku} ${l.name ?? ""} ${l.lot_no ?? ""}`.toLowerCase().includes(needle)),
      ),
    [lines, todo, saved, needle],
  );

  const commit = async (l: SheetLine) => {
    const raw = (vals[l.id] ?? "").trim();
    const was = l.counted_qty === null ? "" : String(Number(l.counted_qty));
    if (raw === "" && saved[l.id] !== "ok") return;
    if (raw !== "" && !/^\d+(\.\d{1,2})?$/.test(raw)) return setSaved((s) => ({ ...s, [l.id]: "Type a number" }));
    if (saved[l.id] === "ok" && raw === was) return;
    setSaved((s) => ({ ...s, [l.id]: "busy" }));
    const r = await saveCountLine(l.id, raw === "" ? null : Number(raw));
    if (r.ok) {
      l.counted_qty = raw === "" ? null : Number(raw);
      setSaved((s) => {
        const next = { ...s };
        if (raw === "") delete next[l.id];
        else next[l.id] = "ok";
        return next;
      });
    } else setSaved((s) => ({ ...s, [l.id]: r.error }));
  };

  let lastGroup: string | null | undefined;
  return (
    <div className="col" style={{ gap: 12 }} data-count={countId}>
      <div className="count-progress">
        <div className="bar" aria-hidden="true"><i style={{ width: `${lines.length ? (counted / lines.length) * 100 : 0}%` }} /></div>
        <span className="small"><b>{counted}</b> of {lines.length} counted</span>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="search grow" style={{ minWidth: 220 }}>
          <Search size={18} />
          <input className="input" type="search" placeholder="Find an item, SKU or lot" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an item" />
        </div>
        <button type="button" className={`chip${todo ? " on" : ""}`} aria-pressed={todo} onClick={() => setTodo((v) => !v)}>
          Not counted yet
        </button>
      </div>
      <div className="list count-list">
        {shown.map((l) => {
          const head = l.group !== lastGroup ? l.group : null;
          lastGroup = l.group;
          const st = saved[l.id];
          return (
            <div key={l.id} className="count-row-wrap">
              {head ? <div className="count-group">{head}</div> : null}
              <div className={`count-row${st === "ok" ? " done" : ""}`}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">{l.name ?? l.sku}</div>
                  <div className="tiny faint">{l.sku}{l.lot_no ? ` · Lot ${l.lot_no}` : ""}{l.unit ? ` · ${unitWord(l.unit)}` : ""}</div>
                  {st && st !== "ok" && st !== "busy" ? <div className="tiny" style={{ color: "var(--err-text)" }}>{st}</div> : null}
                </div>
                <input
                  className="input sm count-in"
                  inputMode="decimal"
                  value={vals[l.id] ?? ""}
                  placeholder="–"
                  aria-label={`Count for ${l.sku}${l.lot_no ? ` lot ${l.lot_no}` : ""}`}
                  onChange={(e) => setVals((v) => ({ ...v, [l.id]: e.target.value }))}
                  onBlur={() => commit(l)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                <span className="count-st" aria-live="polite">
                  {st === "busy" ? <LoaderCircle size={16} className="spin" /> : st === "ok" ? <Check size={16} aria-label="Saved" /> : null}
                </span>
              </div>
            </div>
          );
        })}
        {shown.length === 0 ? <div className="item muted small">{todo ? "Everything's counted." : "Nothing matches."}</div> : null}
      </div>
    </div>
  );
}
