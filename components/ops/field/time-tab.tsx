"use client";

import { useState } from "react";
import { LogIn, LogOut, Trash2, Truck, UserPlus, Users } from "lucide-react";
import { hoursText, punchMinutes } from "@/lib/ops/field/calc";
import type { FieldCrew, FieldTrip, Punch, TimeOp } from "@/lib/ops/field/types";
import { atTime, hhmm, localDate, nowIso, timeOf, useField, uuid } from "./bits";

/** Time clock: each person drives, works on site, or is clocked out. A crew lead can clock the crew. */
export function TimeTab({ trip }: { trip: FieldTrip }) {
  const { bundle, queue, isLead } = useField();
  const lead = isLead(trip);
  const open = (trip.wo?.status ?? "open") !== "reviewed";
  const today = localDate();
  const [showAll, setShowAll] = useState(false);
  const [helper, setHelper] = useState("");
  const crew = [...trip.crew].sort((a, b) => Number(!!b.me) - Number(!!a.me) || Number(!!b.lead) - Number(!!a.lead) || a.name.localeCompare(b.name));
  const canClock = (c: FieldCrew) => open && (lead || !!c.me);
  const openPunch = (crewId: string) => trip.time.find((p) => p.crew === crewId && !p.end);

  const punchOp = (p: Punch, extra: Partial<TimeOp> = {}): TimeOp => ({ t: "time", trip: trip.id, at: nowIso(), id: p.id, crew: p.crew, kind: p.kind, start: p.start, end: p.end, ...extra });

  /** Close what's open and (unless clocking out) start the next kind. */
  const switchTo = (crewIds: string[], kind: "drive" | "site" | "out") => {
    const at = nowIso();
    const ops: TimeOp[] = [];
    for (const id of crewIds) {
      const cur = openPunch(id);
      if (cur && cur.kind === kind) continue;
      if (cur) ops.push(punchOp(cur, { end: at }));
      if (kind !== "out") ops.push({ t: "time", trip: trip.id, at, id: uuid(), crew: id, kind, start: at, end: null });
    }
    if (ops.length) queue(ops);
  };

  const mine = (id: string, day?: string) => trip.time.filter((p) => p.crew === id && (!day || localDate(new Date(p.start)) === day));
  const minutes = (list: Punch[], kind?: string) => list.filter((p) => !kind || p.kind === kind).reduce((s, p) => s + punchMinutes(p), 0);
  const notOnTrip = bundle.crew.filter((c) => !trip.crew.some((t) => t.id === c.id));
  const shown = (showAll ? trip.time : trip.time.filter((p) => localDate(new Date(p.start)) === today)).slice().sort((a, b) => b.start.localeCompare(a.start));

  return (
    <div className="col" style={{ gap: 12 }}>
      {lead && open && crew.length > 1 ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm" onClick={() => switchTo(crew.map((c) => c.id), "site")}><Users size={15} /> Whole crew on site</button>
          <button type="button" className="btn sm dark" onClick={() => switchTo(crew.map((c) => c.id), "drive")}><Truck size={15} /> Whole crew driving</button>
          <button type="button" className="btn sm ghost" onClick={() => switchTo(crew.map((c) => c.id), "out")}><LogOut size={15} /> Clock everyone out</button>
        </div>
      ) : null}

      {crew.map((c) => {
        const cur = openPunch(c.id);
        const day = mine(c.id, today);
        return (
          <section key={c.id} className="card col fld-person" style={{ gap: 10 }}>
            <div className="row between" style={{ gap: 8 }}>
              <span className="col tight" style={{ minWidth: 0 }}>
                <b className="ellipsis">{c.name}{c.me ? " (you)" : ""}</b>
                <span className="tiny faint">{c.lead ? "Crew lead · " : ""}Today {hoursText(minutes(day, "site"))} on site{minutes(day, "drive") ? ` · ${hoursText(minutes(day, "drive"))} driving` : ""}</span>
              </span>
              <span className={`pill ${cur ? (cur.kind === "site" ? "ok" : "info") : "grey"}`}>
                {cur ? `${cur.kind === "site" ? "On site" : "Driving"} since ${timeOf(cur.start)}` : "Clocked out"}
              </span>
            </div>
            {canClock(c) ? (
              <div className="fld-clock">
                {cur?.kind !== "site" ? <button type="button" className="btn" onClick={() => switchTo([c.id], "site")}><LogIn size={17} /> {cur ? "Arrived" : "Clock in"}</button> : null}
                {cur?.kind !== "drive" ? <button type="button" className="btn dark" onClick={() => switchTo([c.id], "drive")}><Truck size={17} /> {cur ? "Driving" : "Start driving"}</button> : null}
                {cur ? <button type="button" className="btn ghost" onClick={() => switchTo([c.id], "out")}><LogOut size={17} /> Clock out</button> : null}
              </div>
            ) : !c.login ? <span className="tiny faint">No login: the crew lead clocks {c.name.split(" ")[0]} in and out.</span> : null}
          </section>
        );
      })}

      {lead && open && notOnTrip.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b className="small"><UserPlus size={15} style={{ verticalAlign: -3 }} /> Someone else came along?</b>
          <div className="row" style={{ gap: 8 }}>
            <select className="input" value={helper} onChange={(e) => setHelper(e.target.value)} aria-label="Crew member">
              <option value="">Pick a crew member</option>
              {notOnTrip.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn sm" disabled={!helper} onClick={() => { switchTo([helper], "site"); setHelper(""); }}>Clock in</button>
          </div>
        </section>
      ) : null}

      <section className="col" style={{ gap: 8 }}>
        <div className="row between">
          <b className="small muted">{showAll ? "Every punch on this trip" : "Today's punches"}</b>
          {trip.time.length ? <button type="button" className="btn sm ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? "Just today" : "All days"}</button> : null}
        </div>
        {!shown.length ? <span className="small muted">No punches yet.</span> : null}
        {shown.map((p) => {
          const who = trip.crew.find((c) => c.id === p.crew) ?? bundle.crew.find((c) => c.id === p.crew);
          const editable = open && (lead || !!who?.me);
          const day = localDate(new Date(p.start));
          return (
            <div key={p.id} className="fld-punch">
              <span className="col tight grow" style={{ minWidth: 0 }}>
                <b className="small ellipsis">{who?.name ?? "Crew"} · {p.kind === "site" ? "On site" : "Driving"}</b>
                <span className="tiny faint">{day !== today ? `${new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ` : ""}{hoursText(punchMinutes(p))}{p.end ? "" : " so far"}</span>
              </span>
              {editable ? (
                <>
                  <input type="time" className="input sm" aria-label="Start" defaultValue={hhmm(p.start)} key={`s${p.start}`}
                    onBlur={(e) => { if (e.target.value && e.target.value !== hhmm(p.start)) queue(punchOp(p, { start: atTime(day, e.target.value) })); }} />
                  <input type="time" className="input sm" aria-label="End" defaultValue={hhmm(p.end)} key={`e${p.end}`} placeholder="–"
                    onBlur={(e) => { const v = e.target.value; if (v !== hhmm(p.end)) queue(punchOp(p, { end: v ? atTime(day, v) : null })); }} />
                  <button type="button" className="iconbtn" aria-label="Delete punch" onClick={() => { if (confirm("Delete this punch?")) queue(punchOp(p, { deleted: true })); }}>
                    <Trash2 size={16} />
                  </button>
                </>
              ) : (
                <span className="small">{timeOf(p.start)} – {p.end ? timeOf(p.end) : "now"}</span>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
