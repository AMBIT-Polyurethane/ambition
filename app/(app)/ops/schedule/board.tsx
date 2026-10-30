"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, ExternalLink, GripVertical, Minus, PackageCheck, Plus, Truck, Users, X } from "lucide-react";
import { saveTrip, scheduleTrip, unscheduleTrip } from "./actions";
import {
  addDays, dayParts, daySpan, lineText, rangeText, suggestDays, timeText, workText,
  type CrewPerson, type JobLine, type Rig, type Trip,
} from "@/lib/ops/schedule";

export type BoardTrip = Trip & {
  job_number: number;
  job_title: string | null;
  customer: string;
  place: string;
  lines: JobLine[];
  crew: { crew_id: string; lead: boolean }[];
};

const NO_RIG = "none";

/** "1 OC · 2 CC sets a day" or "4,000 sq ft a day", from what the rig does. */
function rigDay(r: Rig): string {
  const foam = r.does.some((d) => d.startsWith("foam"));
  const sq = r.does.some((d) => ["blown", "batt", "coating", "other"].includes(d));
  const parts: string[] = [];
  if (foam) parts.push(`${r.oc_sets_day} OC · ${r.cc_sets_day} CC sets`);
  if (sq || !foam) parts.push(`${Number(r.sqft_day).toLocaleString("en-US")} sq ft`);
  return `${parts.join(" · ")} a day`;
}

/** Which rig suits a trip best: the first one that does everything in it (else the first rig). */
function bestRig(t: BoardTrip, rigs: Rig[]): Rig | null {
  const kinds = new Set(t.lines.map((l) => (l.kind === "bibs_mesh" ? "blown" : l.kind === "intumescent" ? "coating" : l.kind === "foam_other" ? "foam_cc" : l.kind)));
  const need = [...kinds].filter((k) => ["foam_oc", "foam_cc", "foam_roof", "blown", "batt", "coating"].includes(k));
  return rigs.find((r) => need.every((k) => r.does.includes(k))) ?? rigs[0] ?? null;
}

/** Stacks a rig's trips into lanes so ones on the same days sit one above the other. */
function lanes(trips: BoardTrip[], from: string) {
  const out: { t: BoardTrip; c0: number; span: number; lane: number; before: boolean; after: boolean }[] = [];
  const ends: number[] = [];
  for (const t of [...trips].sort((a, b) => (a.start_date! < b.start_date! ? -1 : a.start_date! > b.start_date! ? 1 : 0))) {
    const s = daySpan(from, t.start_date!);
    const e = s + t.days - 1;
    const c0 = Math.max(0, s);
    const c1 = Math.min(6, e);
    if (c1 < 0 || c0 > 6) continue;
    let lane = ends.findIndex((x) => x < c0);
    if (lane < 0) { lane = ends.length; ends.push(c1); } else ends[lane] = c1;
    out.push({ t, c0, span: c1 - c0 + 1, lane, before: s < 0, after: e > 6 });
  }
  return { bars: out, count: Math.max(1, ends.length) };
}

export function RigBoard({
  from,
  today,
  rigs,
  crew,
  rigCrew,
  trips: initial,
  dispatch,
  openTrip,
}: {
  from: string;
  today: string;
  rigs: Rig[];
  crew: CrewPerson[];
  rigCrew: Record<string, { crew_id: string; lead: boolean }[]>;
  trips: BoardTrip[];
  dispatch: boolean;
  openTrip: string | null;
}) {
  const router = useRouter();
  const [trips, setTrips] = useState(initial);
  useEffect(() => setTrips(initial), [initial]);
  const [panel, setPanel] = useState<string | null>(openTrip);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const rigById = useMemo(() => new Map(rigs.map((r) => [r.id, r])), [rigs]);

  const waiting = trips.filter((t) => t.status === "unscheduled");
  const placed = trips.filter((t) => t.status !== "unscheduled" && t.start_date);
  const noRig = placed.filter((t) => !t.rig_id || !rigById.has(t.rig_id));

  const put = (id: string, rigId: string | null, day: string) => {
    const t = trips.find((x) => x.id === id);
    if (!t || !dispatch) return;
    const rig = rigId ? rigById.get(rigId) ?? null : null;
    const days = t.status === "unscheduled" ? suggestDays(t.lines, rig) : t.days;
    const before = trips;
    setTrips((all) => all.map((x) => (x.id === id ? { ...x, status: x.status === "in_progress" ? x.status : "scheduled", rig_id: rigId, start_date: day, days, end_date: addDays(day, days - 1) } : x)));
    setErr(null);
    start(async () => {
      const r = await scheduleTrip({ trip: id, rig: rigId, start: day, days, time: t.start_time?.slice(0, 5) ?? null, crew: null });
      if (!r.ok) {
        setTrips(before);
        setErr(r.error);
      } else router.refresh();
    });
  };

  const dropProps = (rigId: string | null, day: string) => {
    const key = `${rigId ?? NO_RIG}|${day}`;
    return dispatch
      ? {
          onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); },
          onDragLeave: () => setOver((o) => (o === key ? null : o)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain") || drag;
            setOver(null);
            setDrag(null);
            if (id) put(id, rigId, day);
          },
        }
      : {};
  };
  const dragProps = (id: string) =>
    dispatch
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; setDrag(id); },
          onDragEnd: () => { setDrag(null); setOver(null); },
        }
      : {};

  const row = (rig: Rig | null, list: BoardTrip[]) => {
    const { bars, count } = lanes(list, from);
    const covering = (i: number) => bars.filter((b) => i >= b.c0 && i < b.c0 + b.span).length;
    const rid = rig?.id ?? null;
    return (
      <div className="rb-row" key={rid ?? NO_RIG}>
        <div className="rb-rig">
          <span className="rig-dot" style={{ background: rig?.color ?? "#71717a" }} aria-hidden="true"><Truck size={14} /></span>
          <span className="col tight" style={{ minWidth: 0 }}>
            <b className="ellipsis">{rig ? rig.name : "No rig"}</b>
            {rig ? <span className="tiny faint ellipsis" title="What it does in a day">{rigDay(rig)}</span> : <span className="tiny faint">Pick a rig for these</span>}
          </span>
        </div>
        <div className="rb-lane" style={{ gridTemplateRows: `repeat(${count}, minmax(58px, auto))` }}>
          {days.map((d, i) => {
            const key = `${rid ?? NO_RIG}|${d}`;
            const n = covering(i);
            return (
              <div
                key={d}
                className={`rb-cell${dayParts(d).weekend ? " wk" : ""}${d === today ? " today" : ""}${over === key ? " over" : ""}${n > 1 ? " busy" : ""}`}
                style={{ gridColumn: i + 1, gridRow: `1 / span ${count}` }}
                {...dropProps(rid, d)}
              >
                {n > 1 ? <span className="rb-busy" title={`${n} trips this day`}>{n}</span> : null}
              </div>
            );
          })}
          {bars.map(({ t, c0, span, lane, before, after }) => (
            <button
              key={t.id}
              type="button"
              className={`rb-bar${t.status === "done" ? " done" : ""}${t.status === "in_progress" ? " live" : ""}${drag === t.id ? " dragging" : ""}`}
              style={{ gridColumn: `${c0 + 1} / span ${span}`, gridRow: lane + 1, ["--rig" as string]: rig?.color ?? "#71717a" }}
              onClick={() => setPanel(t.id)}
              title={`#${t.job_number} ${t.customer} · ${t.name} · ${rangeText(t.start_date, t.days)}`}
              {...dragProps(t.id)}
            >
              {before ? <ChevronLeft size={13} className="rb-more" /> : null}
              <span className="col tight" style={{ minWidth: 0 }}>
                <span className="rb-t ellipsis">#{t.job_number} {t.customer}</span>
                <span className="rb-s ellipsis">{t.start_time ? `${timeText(t.start_time)} · ` : ""}{t.name}{t.place ? ` · ${t.place}` : ""}</span>
              </span>
              {after ? <ChevronRight size={13} className="rb-more" /> : null}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const opened = panel ? trips.find((t) => t.id === panel) ?? null : null;

  return (
    <>
      {err ? <div className="alert err small" role="alert"><span>{err}</span></div> : null}
      <div className={`rb${drag ? " dragging" : ""}`}>
        <aside className="rb-wait" aria-label="Sold work not on the schedule">
          <div className="row between">
            <b>Not scheduled</b>
            <span className="pill warn">{waiting.length}</span>
          </div>
          {dispatch && waiting.length ? <span className="tiny faint">Tap one to schedule it, or drag it onto a rig and day.</span> : null}
          {waiting.map((t) => {
            const rig = bestRig(t, rigs);
            const d = suggestDays(t.lines, rig);
            return (
              <button key={t.id} type="button" className={`rb-card${drag === t.id ? " dragging" : ""}`} onClick={() => setPanel(t.id)} {...dragProps(t.id)}>
                {dispatch ? <GripVertical size={15} className="faint rb-grip" aria-hidden="true" /> : null}
                <span className="col tight" style={{ minWidth: 0, textAlign: "left" }}>
                  <span className="rb-t ellipsis">#{t.job_number} {t.customer}</span>
                  <span className="rb-s ellipsis">{t.name}{t.place ? ` · ${t.place}` : ""}</span>
                  <span className="tiny faint ellipsis">{workText(t.lines)} · about {d} day{d === 1 ? "" : "s"}</span>
                </span>
              </button>
            );
          })}
          {!waiting.length ? <span className="small muted">Everything sold is on the board. New jobs show up here when a customer signs.</span> : null}
        </aside>

        <div className="rb-grid" role="grid" aria-label="Rigs by day">
          <div className="rb-head">
            <div className="rb-corner"><span className="tiny faint">Rig</span></div>
            <div className="rb-days">
              {days.map((d) => {
                const p = dayParts(d);
                return (
                  <div key={d} className={`rb-day${p.weekend ? " wk" : ""}${d === today ? " today" : ""}`}>
                    <span className="tiny">{p.dow}</span>
                    <b>{p.num}</b>
                  </div>
                );
              })}
            </div>
          </div>
          {rigs.length ? rigs.map((r) => row(r, placed.filter((t) => t.rig_id === r.id))) : (
            <div className="rb-empty small muted">
              No rigs yet. {dispatch ? <Link href="/ops/schedule/rigs">Add your rigs and crews</Link> : "The office adds them."} to start scheduling.
            </div>
          )}
          {noRig.length ? row(null, noRig) : null}
        </div>

        {/* Phones: one day after another. */}
        <div className="rb-list">
          {days.map((d) => {
            const on = placed.filter((t) => t.start_date! <= d && addDays(t.start_date!, t.days - 1) >= d);
            const p = dayParts(d);
            return (
              <section key={d} className={`rb-lday${d === today ? " today" : ""}`}>
                <div className="row between"><b>{p.dow}, {p.mon} {p.num}</b><span className="tiny faint">{on.length ? `${on.length} trip${on.length === 1 ? "" : "s"}` : "Open"}</span></div>
                {on.map((t) => {
                  const rig = t.rig_id ? rigById.get(t.rig_id) : null;
                  return (
                    <button key={t.id} type="button" className="rb-litem" onClick={() => setPanel(t.id)} style={{ ["--rig" as string]: rig?.color ?? "#71717a" }}>
                      <span className="col tight" style={{ minWidth: 0, textAlign: "left" }}>
                        <span className="rb-t ellipsis">#{t.job_number} {t.customer}</span>
                        <span className="rb-s ellipsis">{rig?.name ?? "No rig"}{t.start_time ? ` · ${timeText(t.start_time)}` : ""} · {t.name}</span>
                      </span>
                      <ChevronRight size={16} className="faint" />
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>

      {opened ? (
        <TripPanel
          key={opened.id}
          t={opened}
          rigs={rigs}
          crew={crew}
          rigCrew={rigCrew}
          dispatch={dispatch}
          defaultDay={opened.start_date ?? (from <= today && today <= addDays(from, 6) ? today : from)}
          defaultRig={opened.rig_id ?? bestRig(opened, rigs)?.id ?? null}
          onClose={() => setPanel(null)}
          onDone={() => { setPanel(null); router.refresh(); }}
        />
      ) : null}
    </>
  );
}

function TripPanel({
  t, rigs, crew, rigCrew, dispatch, defaultDay, defaultRig, onClose, onDone,
}: {
  t: BoardTrip;
  rigs: Rig[];
  crew: CrewPerson[];
  rigCrew: Record<string, { crew_id: string; lead: boolean }[]>;
  dispatch: boolean;
  defaultDay: string;
  defaultRig: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rig, setRig] = useState<string>(defaultRig ?? "");
  const rigObj = rigs.find((r) => r.id === rig) ?? null;
  const suggested = suggestDays(t.lines, rigObj);
  const [day, setDay] = useState(defaultDay);
  const [days, setDays] = useState(t.status === "unscheduled" ? suggested : t.days);
  const [time, setTime] = useState(t.start_time?.slice(0, 5) ?? "");
  const startCrew = t.crew.length ? t.crew : rigCrew[defaultRig ?? ""] ?? [];
  const [people, setPeople] = useState<Set<string>>(new Set(startCrew.map((c) => c.crew_id)));
  const [lead, setLead] = useState<string>(startCrew.find((c) => c.lead)?.crew_id ?? startCrew[0]?.crew_id ?? "");
  const [notes, setNotes] = useState(t.notes ?? "");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const crewTouched = useRef(false);

  // A different rig brings its own regular crew (until someone picks people by hand).
  const pickRig = (id: string) => {
    setRig(id);
    if (!crewTouched.current && !t.crew.length) {
      const list = rigCrew[id] ?? [];
      setPeople(new Set(list.map((c) => c.crew_id)));
      setLead(list.find((c) => c.lead)?.crew_id ?? list[0]?.crew_id ?? "");
    }
    if (t.status === "unscheduled") setDays(suggestDays(t.lines, rigs.find((r) => r.id === id) ?? null));
  };
  const toggle = (id: string) => {
    crewTouched.current = true;
    setPeople((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const save = () =>
    start(async () => {
      setErr(null);
      const list = [...people];
      const ids = lead && people.has(lead) ? [lead, ...list.filter((x) => x !== lead)] : list;
      const r = await scheduleTrip({ trip: t.id, rig: rig || null, start: day, days, time: time || null, crew: ids });
      if (!r.ok) return setErr(r.error);
      if ((notes || "") !== (t.notes || "")) {
        const n = await saveTrip(t.id, { notes });
        if (!n.ok) return setErr(n.error);
      }
      onDone();
    });
  const off = () =>
    start(async () => {
      const r = await unscheduleTrip(t.id);
      if (!r.ok) return setErr(r.error);
      onDone();
    });

  return (
    <div className="to-modal" role="dialog" aria-modal="true" aria-label={`Trip: ${t.name}`} onClick={busy ? undefined : onClose}>
      <div className="to-modal-panel rb-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
          <span className="col tight" style={{ minWidth: 0 }}>
            <span className="tiny faint">Trip {t.seq} · {t.name}</span>
            <b style={{ fontSize: 18 }}>#{t.job_number} {t.customer}</b>
            {t.place ? <span className="small muted">{t.place}</span> : null}
          </span>
          <button type="button" className="to-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <ul className="job-lines compact">
          {t.lines.map((l) => (
            <li key={l.id}>
              {l.area_code ? <span className="q-code">{l.area_code}</span> : null}
              <span className="grow col tight" style={{ minWidth: 0 }}>
                <span className="small ellipsis">{l.name}</span>
                <span className="tiny faint ellipsis">{lineText(l)}</span>
              </span>
            </li>
          ))}
        </ul>
        <span className="tiny faint">{workText(t.lines)}</span>

        {dispatch ? (
          <>
            <div className="grid2">
              <label className="field">
                <span className="label">Rig</span>
                <select className="select sm" value={rig} onChange={(e) => pickRig(e.target.value)}>
                  {!rigs.length ? <option value="">No rigs yet</option> : null}
                  {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="label">First day</span>
                <input className="input sm" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
            </div>
            <div className="grid2">
              <div className="field">
                <span className="label">How many days</span>
                <div className="mat-qty" role="group" aria-label="How many days">
                  <button type="button" onClick={() => setDays((d) => Math.max(1, d - 1))} aria-label="One day less"><Minus size={15} /></button>
                  <input inputMode="numeric" value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value.replace(/\D/g, "")) || 1)))} aria-label="Days" />
                  <button type="button" onClick={() => setDays((d) => Math.min(60, d + 1))} aria-label="One more day"><Plus size={15} /></button>
                </div>
                <span className="tiny faint">
                  Suggested: {suggested} day{suggested === 1 ? "" : "s"}{rigObj ? ` on ${rigObj.name}` : ""}
                  {days !== suggested ? <> · <button type="button" className="linkbtn tiny" onClick={() => setDays(suggested)}>Use it</button></> : null}
                </span>
              </div>
              <label className="field">
                <span className="label"><Clock size={13} style={{ verticalAlign: -2 }} /> Start time (optional)</span>
                <input className="input sm" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div className="field">
              <span className="label"><Users size={13} style={{ verticalAlign: -2 }} /> Crew</span>
              {crew.length ? (
                <div className="crew-pick">
                  {crew.map((c) => (
                    <div key={c.id} className="crew-opt">
                      <label className="check grow"><input type="checkbox" checked={people.has(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>
                      <label className="tiny faint check"><input type="radio" name="lead" checked={lead === c.id} onChange={() => { crewTouched.current = true; setLead(c.id); if (!people.has(c.id)) toggle(c.id); }} /> Lead</label>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="small muted">No crew yet. <Link href="/ops/schedule/rigs">Add people</Link>.</span>
              )}
            </div>
            <label className="field">
              <span className="label">Note for the crew on this trip (optional)</span>
              <textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bring the 300 ft hose. Customer home after 2." />
            </label>
            {err ? <div className="alert err small" role="alert"><span>{err}</span></div> : null}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn sm" disabled={busy || !day} onClick={save}>
                <CalendarPlus size={15} /> {busy ? "Saving…" : t.status === "unscheduled" ? `Schedule ${rangeText(day, days)}` : "Save"}
              </button>
              {t.status === "scheduled" ? <button type="button" className="btn sm ghost" disabled={busy} onClick={off}>Take off the board</button> : null}
              <Link className="btn sm dark" href={`/ops/stock/check?trip=${t.id}`}><PackageCheck size={15} /> Stock check</Link>
              <Link className="btn sm dark" href={`/ops/jobs/${t.job_id}`}><ExternalLink size={15} /> Job</Link>
            </div>
          </>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            <span className="small"><b>{rangeText(t.start_date, t.days)}</b>{t.start_time ? ` · ${timeText(t.start_time)}` : ""}</span>
            <Link className="btn sm dark" href={`/ops/jobs/${t.job_id}`}><ExternalLink size={15} /> Job</Link>
          </div>
        )}
      </div>
    </div>
  );
}
