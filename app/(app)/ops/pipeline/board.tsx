"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, MapPin, Trophy, X } from "lucide-react";
import { moveLead } from "../crm-actions";
import { CLOSED, type Stage } from "@/lib/ops/defaults";
import { daysSince, money0 } from "@/lib/ops/crm";

export type BoardLead = {
  id: string;
  number: number;
  name: string;
  title: string | null;
  stage: string;
  services: string[];
  value: number | null;
  next_at: string | null;
  created_at: string;
  stage_changed_at: string;
  rep: string | null;
  where: string;
  source: string | null;
  lost_reason: string | null;
};

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/**
 * The pipeline. On a computer: a column per stage; drag a card to move it (or use its menu). On a phone:
 * pick a stage at the top, and each card has a "Move to" menu. Lost always asks why.
 */
export function PipelineBoard({ leads: initial, stages, lostReasons, canMove }: { leads: BoardLead[]; stages: Stage[]; lostReasons: string[]; canMove: boolean }) {
  const [leads, setLeads] = useState(initial);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: string; from: string } | null>(null);
  const [reason, setReason] = useState(lostReasons[0] ?? "Other");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // On a phone, open on the first stage that has something in it.
  const [tab, setTab] = useState(() => stages.find((s) => initial.some((l) => l.stage === s.key))?.key ?? stages[0]?.key ?? "new");
  const [, start] = useTransition();
  const t = today();

  const by = useMemo(() => {
    const m = new Map<string, BoardLead[]>();
    for (const s of stages) m.set(s.key, []);
    for (const l of leads) (m.get(l.stage) ?? m.get(stages[0].key))!.push(l);
    return m;
  }, [leads, stages]);

  const move = (id: string, stage: string, lostReason?: string) => {
    const before = leads.find((l) => l.id === id);
    if (!before || before.stage === stage) return;
    if (stage === "lost" && !lostReason) {
      setAsking({ id, from: before.stage });
      return;
    }
    setError(null);
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, stage, stage_changed_at: new Date().toISOString(), lost_reason: lostReason ?? null } : l)));
    start(async () => {
      const r = await moveLead(id, stage, lostReason ?? null);
      if (!r.ok) {
        setError(r.error ?? "Couldn't move it.");
        setLeads((ls) => ls.map((l) => (l.id === id ? before : l)));
      }
    });
  };

  const card = (l: BoardLead) => {
    const late = !!l.next_at && l.next_at < t && !CLOSED.includes(l.stage);
    const due = !!l.next_at && l.next_at === t && !CLOSED.includes(l.stage);
    return (
      <div
        key={l.id}
        className={`pl-card${drag === l.id ? " dragging" : ""}`}
        draggable={canMove}
        onDragStart={(e) => {
          setDrag(l.id);
          e.dataTransfer.setData("text/plain", l.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
      >
        <Link href={`/ops/leads/${l.id}`} className="pl-link" draggable={false}>
          <span className="row between" style={{ gap: 8 }}>
            <b className="ellipsis">{l.name}</b>
            <span className="tiny faint">#{l.number}</span>
          </span>
          {l.title || l.services.length ? <span className="small ellipsis pl-what">{l.title || l.services.join(", ")}</span> : null}
          <span className="pl-meta">
            {l.where ? <span className="tiny faint ellipsis"><MapPin size={12} /> {l.where}</span> : null}
            {l.value ? <span className="tiny pl-val">{money0(l.value)}</span> : null}
          </span>
          <span className="pl-foot">
            {l.stage === "lost" ? (
              <span className="tiny red ellipsis">Lost: {l.lost_reason}</span>
            ) : l.stage === "won" ? (
              <span className="tiny ok-text"><Trophy size={12} /> Won {short(l.stage_changed_at.slice(0, 10))}</span>
            ) : l.next_at ? (
              <span className={`tiny pl-next${late ? " late" : due ? " today" : ""}`}><CalendarClock size={12} /> {due ? "Today" : short(l.next_at)}</span>
            ) : (
              <span className="tiny faint">{daysSince(l.stage_changed_at) === 0 ? "Today" : `${daysSince(l.stage_changed_at)}d in stage`}</span>
            )}
            {l.rep ? <span className="pl-rep" title={l.rep}>{initials(l.rep)}</span> : null}
          </span>
        </Link>
        {canMove ? (
          <select
            className="pl-move"
            aria-label={`Move ${l.name} to`}
            value=""
            onChange={(e) => {
              if (e.target.value) move(l.id, e.target.value);
            }}
          >
            <option value="">Move to…</option>
            {stages.filter((s) => s.key !== l.stage).map((s) => (
              <option key={s.key} value={s.key}>{s.name}</option>
            ))}
          </select>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <div className="chips scroll-x pl-tabs" role="tablist" aria-label="Stage">
        {stages.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={tab === s.key} className={`chip${tab === s.key ? " on" : ""}`} onClick={() => setTab(s.key)}>
            {s.name} <span className="pl-count">{by.get(s.key)?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="pl-board">
        {stages.map((s) => {
          const list = by.get(s.key) ?? [];
          const total = list.reduce((a, l) => a + (l.value ?? 0), 0);
          return (
            <section
              key={s.key}
              className={`pl-col${CLOSED.includes(s.key) ? ` closed ${s.key}` : ""}${over === s.key ? " over" : ""}${tab === s.key ? " tab-on" : ""}`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setOver(s.key);
              }}
              onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || drag;
                setOver(null);
                setDrag(null);
                if (id) move(id, s.key);
              }}
              aria-label={s.name}
            >
              <header className="pl-head">
                <b>{s.name}</b>
                <span className="tiny faint">{list.length}{total ? ` · ${money0(total)}` : ""}</span>
              </header>
              <div className="pl-list">
                {list.length ? list.map(card) : <div className="pl-empty tiny faint"><span className="pl-drag">{canMove ? "Drag a lead here" : "None"}</span><span className="pl-none">No leads here</span></div>}
              </div>
            </section>
          );
        })}
      </div>

      {asking ? (
        <div className="ops-modal" role="dialog" aria-modal="true" aria-label="Why was it lost?">
          <div className="ops-modal-card col" style={{ gap: 12 }}>
            <div className="row between">
              <b>Why was it lost?</b>
              <button type="button" className="iconbtn sm" aria-label="Cancel" onClick={() => setAsking(null)}><X size={18} /></button>
            </div>
            <div className="chips wrap">
              {lostReasons.map((r) => (
                <button key={r} type="button" className={`chip${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>{r}</button>
              ))}
            </div>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to add (optional): who they went with, their price…" maxLength={100} />
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const a = asking;
                  setAsking(null);
                  move(a.id, "lost", [reason, note.trim()].filter(Boolean).join(": "));
                  setNote("");
                }}
              >
                Mark lost
              </button>
              <button type="button" className="btn ghost" onClick={() => setAsking(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
