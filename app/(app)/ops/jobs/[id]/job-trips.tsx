"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowRightLeft, CalendarPlus, CalendarRange, Check, PackageCheck, Pencil, Users, X } from "lucide-react";
import { moveLines, saveTrip } from "../../schedule/actions";
import { TRIP_STATUS, lineText, rangeText, suggestDays, timeText, workText, type CrewPerson, type JobLine, type Rig, type Trip } from "@/lib/ops/schedule";

/** A job's trips: what each one does, when and on which rig; tick work and move it to another trip. */
export function JobTrips({
  trips,
  lines,
  tripCrew,
  rigs,
  crew,
  dispatch,
}: {
  trips: Trip[];
  lines: JobLine[];
  tripCrew: { trip_id: string; crew_id: string; lead: boolean }[];
  rigs: Rig[];
  crew: CrewPerson[];
  dispatch: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState<string>("new");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const rigById = useMemo(() => new Map(rigs.map((r) => [r.id, r])), [rigs]);
  const crewById = useMemo(() => new Map(crew.map((c) => [c.id, c])), [crew]);
  const open = (t: Trip) => t.status === "unscheduled" || t.status === "scheduled";
  const loose = lines.filter((l) => !l.trip_id || !trips.some((t) => t.id === l.trip_id));

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = (f: () => Promise<{ ok: boolean; error?: string; msg?: string }>, after?: () => void) =>
    start(async () => {
      setMsg(null);
      const r = await f();
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "That didn't save." });
      else {
        if (r.msg) setMsg({ ok: true, text: r.msg });
        after?.();
        router.refresh();
      }
    });

  const targets = trips.filter(open);
  return (
    <section className="col" style={{ gap: 12 }}>
      <div className="row between">
        <b style={{ fontSize: 17 }}>Trips</b>
        <span className="tiny faint">{dispatch ? "Tick work to move it to another trip (foam now, blown attic later)." : ""}</span>
      </div>
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"} small`} role="status"><span>{msg.text}</span></div> : null}

      {trips.map((t) => {
        const mine = lines.filter((l) => l.trip_id === t.id);
        const rig = t.rig_id ? rigById.get(t.rig_id) ?? null : null;
        const people = tripCrew.filter((c) => c.trip_id === t.id).sort((a, b) => Number(b.lead) - Number(a.lead));
        const st = TRIP_STATUS[t.status];
        const est = suggestDays(mine, rig);
        return (
          <article key={t.id} className={`card col job-trip${t.status === "cancelled" ? " off" : ""}`} style={{ gap: 10 }}>
            <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
              <span className="col tight" style={{ minWidth: 0 }}>
                <span className="tiny faint">Trip {t.seq}</span>
                {editing === t.id ? (
                  <span className="row" style={{ gap: 6 }}>
                    <input className="input sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Trip name" autoFocus />
                    <button type="button" className="iconbtn" aria-label="Save name" disabled={busy} onClick={() => run(() => saveTrip(t.id, { name }), () => setEditing(null))}><Check size={16} /></button>
                    <button type="button" className="iconbtn" aria-label="Cancel" onClick={() => setEditing(null)}><X size={16} /></button>
                  </span>
                ) : (
                  <b className="row" style={{ gap: 6 }}>
                    {t.name}
                    {dispatch && open(t) ? (
                      <button type="button" className="linkbtn tiny" aria-label={`Rename ${t.name}`} onClick={() => { setEditing(t.id); setName(t.name); }}><Pencil size={12} /></button>
                    ) : null}
                  </b>
                )}
              </span>
              <span className={st.cls}>{st.label}</span>
            </div>

            <div className="job-when">
              <span className="row" style={{ gap: 6 }}>
                {rig ? <span className="rig-dot sm" style={{ background: rig.color ?? "#4b5563" }} aria-hidden="true" /> : <CalendarRange size={15} className="faint" />}
                <span>
                  {t.start_date ? <b>{rangeText(t.start_date, t.days)}</b> : <span className="muted">Not on the board yet</span>}
                  {t.start_time ? ` · ${timeText(t.start_time)}` : ""}
                  {rig ? ` · ${rig.name}` : ""}
                </span>
              </span>
              <span className="tiny faint">{workText(mine)} · about {est} day{est === 1 ? "" : "s"}{rig ? ` on ${rig.name}` : ""}</span>
              {people.length ? (
                <span className="tiny faint row" style={{ gap: 4 }}><Users size={13} /> {people.map((p) => `${crewById.get(p.crew_id)?.name ?? "?"}${p.lead ? " (lead)" : ""}`).join(", ")}</span>
              ) : null}
            </div>

            <ul className="job-lines">
              {mine.map((l) => (
                <li key={l.id} className={picked.has(l.id) ? "on" : ""}>
                  {dispatch && open(t) ? (
                    <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Pick ${l.name}`} />
                  ) : null}
                  {l.area_code ? <span className="q-code">{l.area_code}</span> : null}
                  <span className="grow col tight" style={{ minWidth: 0 }}>
                    <span className="small ellipsis">{l.name}</span>
                    <span className="tiny faint ellipsis">{lineText(l)}</span>
                  </span>
                </li>
              ))}
              {!mine.length ? <li className="tiny faint">No work in this trip.</li> : null}
            </ul>

            {dispatch && open(t) ? (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Link className="btn sm" href={`/ops/schedule?trip=${t.id}${t.start_date ? `&d=${t.start_date}` : ""}`}>
                  {t.status === "scheduled" ? <><CalendarRange size={15} /> See it on the board</> : <><CalendarPlus size={15} /> Put it on the board</>}
                </Link>
                <Link className="btn sm dark" href={`/ops/stock/check?trip=${t.id}`}><PackageCheck size={15} /> Stock check</Link>
              </div>
            ) : null}
            {t.notes ? <span className="small muted">Note: {t.notes}</span> : null}
          </article>
        );
      })}

      {loose.length ? (
        <div className="card small muted">Work not in any trip: {loose.map((l) => l.name).join(", ")}</div>
      ) : null}

      {dispatch && picked.size ? (
        <div className="job-move" role="region" aria-label="Move the picked work">
          <ArrowRightLeft size={16} />
          <span className="small"><b>{picked.size}</b> picked. Move to</span>
          <select className="select sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Move to">
            <option value="new">A new trip</option>
            {targets.map((t) => <option key={t.id} value={t.id}>Trip {t.seq}: {t.name}</option>)}
          </select>
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => run(() => moveLines([...picked], to === "new" ? null : to), () => { setPicked(new Set()); setTo("new"); })}
          >
            {busy ? "Moving…" : "Move"}
          </button>
          <button type="button" className="linkbtn small" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      ) : null}
    </section>
  );
}
