"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen, Check, CircleAlert, LoaderCircle, RotateCcw, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { SHEET_KIND_LABEL, componentSqft, type Reconciled, type SheetAi, type TakeoffAi } from "@/lib/takeoff/ai-read";
import type { ComponentRow } from "@/lib/takeoff/ai-apply";
import { num } from "@/lib/takeoff/calc";

// The takeoff AI's side of the workspace: reading the plan set, the assistant card for the sheet on screen
// (accept, discard, tell it what it got wrong and remember it), windows and doors, and the alerts.

type SheetLite = { id: string; name: string | null; page: number; ai?: SheetAi | null };
export type RunState = { phase: "reading" | "checking" | "done"; sheets: Record<string, { state: "waiting" | "reading" | "done" | "error"; msg?: string }>; cost: number };

const cents = (c: number) => (c >= 100 ? `$${num(c / 100, 2)}` : `${num(c, 1)}¢`);

export function AiReadDialog({
  sheets,
  builder,
  run,
  onStart,
  onClose,
}: {
  sheets: SheetLite[];
  builder: string;
  run: RunState | null;
  onStart: (ids: string[], builder: string) => void;
  onClose: () => void;
}) {
  const unread = sheets.filter((s) => !s.ai).map((s) => s.id);
  const [pick, setPick] = useState<string[]>(unread.length ? unread.slice(0, 40) : sheets.slice(0, 40).map((s) => s.id));
  const [b, setB] = useState(builder);
  const busy = Boolean(run && run.phase !== "done");
  const done = run ? Object.values(run.sheets).filter((x) => x.state === "done").length : 0;
  const errs = run ? Object.entries(run.sheets).filter(([, x]) => x.state === "error") : [];

  return (
    <div className="to-modal" role="dialog" aria-modal="true" aria-label="Read plan set with AI" onClick={busy ? undefined : onClose}>
      <div className="to-modal-panel ps-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <b style={{ fontSize: 17 }}><Sparkles size={17} style={{ verticalAlign: -3, color: "var(--red)" }} /> Read plan set with AI</b>
          {!busy ? <button type="button" className="to-x" onClick={onClose} aria-label="Close"><X size={16} /></button> : null}
        </div>
        {!run ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              The AI reads each sheet and draws every insulated surface on it: walls, ceilings, floors, slab, roof lines, plus windows and doors. Its shapes are
              dashed until you accept or fix them. Walls, ceilings and floors are counted from the floor plans; elevations are drawn for reference only. Then it
              checks the sheets against each other and lists anything that disagrees.
            </p>
            <label className="field">
              <span className="label">Builder (rules taught for this builder are used too)</span>
              <input className="input sm" value={b} onChange={(e) => setB(e.target.value)} maxLength={80} placeholder="From the title block (optional)" />
            </label>
            <div className="row between">
              <span className="label">Sheets to read ({pick.length})</span>
              <span className="row" style={{ gap: 10 }}>
                <button type="button" className="linkbtn small" onClick={() => setPick(sheets.slice(0, 40).map((s) => s.id))}>All</button>
                {unread.length && unread.length < sheets.length ? <button type="button" className="linkbtn small" onClick={() => setPick(unread.slice(0, 40))}>Not read yet</button> : null}
                <button type="button" className="linkbtn small" onClick={() => setPick([])}>None</button>
              </span>
            </div>
            <div className="ps-sheets">
              {sheets.map((s) => {
                const on = pick.includes(s.id);
                return (
                  <label key={s.id} className={`ps-sheet${on ? " on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => setPick((p) => (on ? p.filter((x) => x !== s.id) : p.length >= 40 ? p : [...p, s.id]))} />
                    <span className="ellipsis">{s.name || `Page ${s.page}`}</span>
                    {s.ai ? <Sparkles size={12} className="faint" aria-label="Read before" /> : null}
                  </label>
                );
              })}
            </div>
            <span className="tiny faint">
              Four sheets at a time, about a minute or two each. Reading a sheet again replaces only the AI shapes on it that nobody checked yet.
            </span>
            <button type="button" className="btn sm" disabled={!pick.length} onClick={() => onStart(pick, b.trim())}>
              <Sparkles size={15} /> Read {pick.length} sheet{pick.length === 1 ? "" : "s"}
            </button>
          </>
        ) : (
          <>
            <div className="ps-busy">
              {busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}
              {run.phase === "reading"
                ? `Reading sheets: ${done} of ${Object.keys(run.sheets).length} done…`
                : run.phase === "checking"
                  ? "Checking the sheets against each other…"
                  : `Done. ${done} sheet${done === 1 ? "" : "s"} read${run.cost ? ` · ${cents(run.cost)}` : ""}.`}
            </div>
            <div className="ai-run">
              {sheets
                .filter((s) => run.sheets[s.id])
                .map((s) => {
                  const st = run.sheets[s.id];
                  return (
                    <div key={s.id} className={`ai-run-row ${st.state}`}>
                      {st.state === "reading" ? <LoaderCircle size={14} className="spin" /> : st.state === "done" ? <Check size={14} /> : st.state === "error" ? <CircleAlert size={14} /> : <span className="dot" />}
                      <b className="ellipsis">{s.name || `Page ${s.page}`}</b>
                      <span className="tiny faint ellipsis">{st.msg ?? (st.state === "waiting" ? "Waiting" : st.state === "reading" ? "Reading…" : "")}</span>
                    </div>
                  );
                })}
            </div>
            {errs.length ? <div className="alert warn small"><span>{errs.length} sheet{errs.length === 1 ? "" : "s"} didn&apos;t read. Pick {errs.length === 1 ? "it" : "them"} and read again.</span></div> : null}
            {!busy ? <button type="button" className="btn sm" onClick={onClose}>See the shapes</button> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The AI assistant card for the sheet on screen. */
export function AiSheetCard({
  sheet,
  unchecked,
  windows,
  alerts,
  builder,
  busy,
  staff,
  onAccept,
  onDiscard,
  onCorrect,
  onReread,
  scaleCheck,
}: {
  sheet: SheetLite;
  /** The AI's long written dimension against the sheet's scale. */
  scaleCheck?: { written: number; measured: number | null; quote: string; onUse: () => void } | null;
  unchecked: number;
  windows: number;
  alerts: number;
  builder: string;
  busy: string | null;
  staff: boolean;
  onAccept: () => void;
  onDiscard: () => void;
  onCorrect: (text: string, remember: "once" | "all" | "builder", builder: string) => void;
  onReread: () => void;
}) {
  const ai = sheet.ai!;
  const r = ai.read;
  const [text, setText] = useState("");
  const [remember, setRemember] = useState<"once" | "all" | "builder">("once");
  const [b, setB] = useState(builder);
  const [open, setOpen] = useState(false);
  const name = sheet.name || `Page ${sheet.page}`;
  const visibleRules = ai.rules.filter((x) => x.text);

  return (
    <section className="ai-card" aria-label="AI assistant">
      <div className="row between" style={{ gap: 6 }}>
        <b className="ai-title"><Sparkles size={15} /> AI assistant</b>
        {unchecked ? <span className="pill ai">{unchecked} to check</span> : <span className="pill ok">Checked</span>}
      </div>
      <div className="col tight">
        <b className="small">{SHEET_KIND_LABEL[r.sheet_kind]}{r.level ? ` · ${r.level}` : ""}{r.elevation_side !== "none" ? ` · ${r.elevation_side}` : ""}</b>
        <span className="tiny faint">
          {r.assemblies.length} shape{r.assemblies.length === 1 ? "" : "s"} drawn · {windows} window{windows === 1 ? "" : "s"} & doors
          {alerts ? <> · <span className="warn-text">{alerts} to check against other sheets</span></> : null}
        </span>
        {ai.correction ? <span className="tiny faint">Last fix: &ldquo;{ai.correction}&rdquo;</span> : null}
      </div>
      {scaleCheck ? (
        scaleCheck.measured !== null && Math.abs(scaleCheck.measured - scaleCheck.written) / scaleCheck.written < 0.03 ? (
          <span className="tiny ok-text"><Check size={12} style={{ verticalAlign: -2 }} /> Scale checks out: {scaleCheck.quote || `${scaleCheck.written} ft`} measures {num(scaleCheck.measured, 1)} ft.</span>
        ) : (
          <span className="tiny warn-text">
            <TriangleAlert size={12} style={{ verticalAlign: -2 }} />{" "}
            {scaleCheck.measured === null ? `No scale set. ${scaleCheck.quote || `${scaleCheck.written} ft`} is written on the sheet.` : `Scale check: ${scaleCheck.quote || `${scaleCheck.written} ft`} measures ${num(scaleCheck.measured, 1)} ft at this scale.`}{" "}
            <button type="button" className="linkbtn tiny" onClick={scaleCheck.onUse}>Use the written dimension as the scale</button>
          </span>
        )
      ) : null}
      {r.notes.length ? (
        <ul className="ai-notes">
          {r.notes.slice(0, open ? 20 : 3).map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      ) : null}
      <button type="button" className="linkbtn tiny" onClick={() => setOpen((v) => !v)}>
        {open ? "Less" : `What it saw${ai.rules.length ? ` · followed ${ai.rules.length} team rule${ai.rules.length === 1 ? "" : "s"}` : ""}`}
      </button>
      {open ? (
        <div className="ai-more">
          {r.analysis ? <p className="tiny" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.analysis}</p> : null}
          {r.scale.text || r.dimension_check ? (
            <span className="tiny faint">
              Scale: {r.scale.text || "not printed"}
              {r.dimension_check ? ` · checked against ${r.dimension_check.quote || `${r.dimension_check.feet} ft`}` : ""}
            </span>
          ) : null}
          {ai.rules.length ? (
            <div className="col tight">
              <b className="tiny">Team rules it followed</b>
              {visibleRules.length ? (
                <ul className="ai-notes">
                  {visibleRules.map((x) => <li key={x.id}>{x.builder ? <b>{x.builder}: </b> : null}{x.text}</li>)}
                </ul>
              ) : null}
              {ai.rules.length > visibleRules.length ? <span className="tiny faint">Plus {ai.rules.length - visibleRules.length} of AMBIT&apos;s measuring rules.</span> : null}
            </div>
          ) : null}
          <span className="tiny faint">{ai.model} · {new Date(ai.at).toLocaleString()}{ai.cost_cents ? ` · ${cents(ai.cost_cents)}` : ""}</span>
        </div>
      ) : null}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn sm ai-accept" disabled={!unchecked || Boolean(busy)} onClick={onAccept}>
          <Check size={15} /> Accept {unchecked || ""} on this sheet
        </button>
        <button type="button" className="btn sm dark" disabled={!unchecked || Boolean(busy)} onClick={onDiscard} title="Remove the AI shapes nobody checked yet">
          <Trash2 size={14} /> Discard
        </button>
        <button type="button" className="btn sm dark" disabled={Boolean(busy)} onClick={onReread} title="Read this sheet again">
          <RotateCcw size={14} />
        </button>
      </div>
      <form
        className="ai-fix"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onCorrect(text.trim(), remember, b.trim());
        }}
      >
        <label className="tiny" htmlFor="ai-fix-text"><b>Tell the AI what it got wrong on {name}</b></label>
        <textarea
          id="ai-fix-text"
          className="input sm"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="The master bedroom is a tray ceiling, not vaulted: flat center with 2 ft risers."
        />
        <div className="ai-remember" role="radiogroup" aria-label="Remember this">
          {(
            [
              ["once", "Just this time"],
              ["all", "Remember for all plans"],
              ["builder", "Remember for this builder"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className={`chip sm${remember === k ? " on" : ""}`}>
              <input type="radio" name="remember" value={k} checked={remember === k} onChange={() => setRemember(k)} />
              {label}
            </label>
          ))}
        </div>
        {remember === "builder" ? <input className="input sm" value={b} onChange={(e) => setB(e.target.value)} maxLength={80} placeholder="Builder's name" aria-label="Builder" required /> : null}
        {remember !== "once" ? (
          <span className="tiny faint">
            It&apos;s saved as a rule the AI follows on {remember === "all" ? "every plan" : `every plan from ${b || "this builder"}`}
            {staff ? "" : " your company reads"}. See or change it in <Link href="/takeoff/rules">Rules</Link>.
          </span>
        ) : null}
        <button type="submit" className="btn sm" disabled={!text.trim() || Boolean(busy) || (remember === "builder" && !b.trim())}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} {busy ?? "Fix this sheet"}
        </button>
      </form>
    </section>
  );
}

/** Windows and doors the AI found, every sheet. */
export function WindowsTab({
  comps,
  reconcile,
  sheetName,
  onDeduct,
  onSheet,
}: {
  comps: ComponentRow[];
  reconcile: Reconciled | null;
  sheetName: (id: string | null) => string;
  onDeduct: (sqft: number) => void;
  onSheet: (id: string) => void;
}) {
  // The cross-sheet check's list (each window once) is the count; without it, the floor plans' own.
  const merged = reconcile?.components ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, { code: string; kind: string; qty: number; sqft: number; sheets: Set<string> }>();
    for (const c of comps) {
      const k = `${c.kind}|${c.code ?? "?"}`;
      const g = m.get(k) ?? { code: c.code ?? "Size not given", kind: c.kind, qty: 0, sqft: 0, sheets: new Set<string>() };
      g.qty += c.qty;
      g.sqft += componentSqft(c);
      if (c.sheet_id) g.sheets.add(c.sheet_id);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.qty - a.qty);
  }, [comps]);
  const total = merged.length ? merged.reduce((s, c) => s + componentSqft(c), 0) : 0;
  if (!comps.length && !merged.length) return <div className="to-hint"><b>No windows or doors yet.</b><span>Read the plan set with AI and they&apos;re listed here, by size.</span></div>;
  return (
    <div className="col" style={{ gap: 10 }}>
      {merged.length ? (
        <div className="ai-box">
          <div className="row between"><b className="small">Openings, each counted once</b><span className="tiny faint">{merged.reduce((s, c) => s + c.qty, 0)} total</span></div>
          <table className="ai-tbl">
            <tbody>
              {merged.map((c, i) => (
                <tr key={i}>
                  <td>{c.kind.replace("_", " ")}</td>
                  <td><b>{c.code || "–"}</b></td>
                  <td className="num">× {c.qty}</td>
                  <td className="num">{num(componentSqft(c))} sq ft</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row between" style={{ gap: 8 }}>
            <span className="small"><b>{num(total)} sq ft</b> of openings</span>
            <button type="button" className="btn sm dark" disabled={!total} onClick={() => onDeduct(Math.round(total))}>Take out of exterior walls</button>
          </div>
        </div>
      ) : null}
      <div className="col tight">
        <b className="tiny faint">FOUND ON EACH SHEET</b>
        {groups.map((g) => (
          <div key={`${g.kind}${g.code}`} className="ai-win">
            <span className={`ai-dot ${g.kind}`} />
            <span className="col tight grow" style={{ minWidth: 0 }}>
              <b className="small">{g.code} <span className="faint">× {g.qty}</span></b>
              <span className="tiny faint ellipsis">
                {g.kind.replace("_", " ")} ·{" "}
                {[...g.sheets].map((id, i) => (
                  <span key={id}>
                    {i ? ", " : ""}
                    <button type="button" className="linkbtn tiny" onClick={() => onSheet(id)}>{sheetName(id)}</button>
                  </span>
                ))}
              </span>
            </span>
            <span className="tiny">{g.sqft ? `${num(g.sqft)} sq ft` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** What disagrees between sheets, and what the AI settled on. */
export function AlertsTab({
  ai,
  onCheck,
  onSheetName,
  busy,
  onRecheck,
}: {
  ai: TakeoffAi | null;
  onCheck: (key: string, on: boolean) => void;
  onSheetName: (name: string) => void;
  busy: boolean;
  onRecheck: () => void;
}) {
  if (!ai) return <div className="to-hint"><b>No alerts yet.</b><span>After the AI reads the plan set it checks the sheets against each other and lists what disagrees here.</span></div>;
  const rec = ai.reconcile;
  const checked = new Set(ai.checked);
  const order = { high: 0, medium: 1, low: 2 } as const;
  const list = [...rec.discrepancies].sort((a, b) => Number(checked.has(a.key)) - Number(checked.has(b.key)) || order[a.severity] - order[b.severity]);
  return (
    <div className="col" style={{ gap: 8 }}>
      {rec.summary ? <p className="small muted" style={{ margin: 0 }}>{rec.summary}</p> : null}
      {list.map((d) => {
        const on = checked.has(d.key);
        return (
          <div key={d.key} className={`ai-alert ${d.severity}${on ? " done" : ""}`}>
            <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <TriangleAlert size={15} style={{ flex: "none", marginTop: 2 }} />
              <b className="small grow">{d.title}</b>
            </div>
            {d.detail ? <span className="tiny">{d.detail}</span> : null}
            <div className="row between" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                {d.sheets.map((s) => (
                  <button key={s} type="button" className="ai-chip" onClick={() => onSheetName(s)}>{s}</button>
                ))}
              </span>
              <button type="button" className="linkbtn tiny" onClick={() => onCheck(d.key, !on)}>{on ? "Undo" : "Checked it"}</button>
            </div>
          </div>
        );
      })}
      {rec.heights.length || rec.pitches.length || rec.facts.length ? (
        <div className="ai-box">
          <b className="small">What the plans say</b>
          <ul className="ai-notes">
            {rec.heights.map((h, i) => <li key={`h${i}`}>{h.what}: <b>{num(h.height_ft, 2)} ft</b> <span className="faint">({h.sheets.join(", ")})</span></li>)}
            {rec.pitches.map((p, i) => <li key={`p${i}`}>{p.where}: <b>{num(p.rise, 1)}/12</b> <span className="faint">({p.sheets.join(", ")})</span></li>)}
            {rec.facts.map((f, i) => <li key={`f${i}`}>{f.value} <span className="faint">({f.sheets.join(", ")})</span></li>)}
          </ul>
        </div>
      ) : null}
      <div className="row between">
        <span className="tiny faint">Checked {new Date(ai.at).toLocaleString()}</span>
        <button type="button" className="linkbtn tiny" disabled={busy} onClick={onRecheck}>{busy ? "Checking…" : "Check again"}</button>
      </div>
      <Link href="/takeoff/rules" className="linkbtn tiny"><BookOpen size={13} /> Rules the AI follows</Link>
    </div>
  );
}
