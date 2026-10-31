"use client";

import { useEffect, useState } from "react";
import { Camera, ChevronLeft, Clock, FlagTriangleRight, KeyRound, MapPin, NotebookPen, Package, Phone, Ruler, Truck } from "lucide-react";
import type { FieldTrip } from "@/lib/ops/field/types";
import { dayLabel, localDate, useField } from "./bits";
import { TimeTab } from "./time-tab";
import { MaterialTab } from "./material-tab";
import { LogTab } from "./log-tab";
import { AreasTab } from "./areas-tab";
import { PhotosTab } from "./photos-tab";
import { FinishTab } from "./finish-tab";

const TABS = [
  { key: "time", label: "Time", icon: Clock },
  { key: "material", label: "Material", icon: Package },
  { key: "log", label: "Spray log", icon: NotebookPen },
  { key: "areas", label: "Areas", icon: Ruler },
  { key: "photos", label: "Photos", icon: Camera },
  { key: "finish", label: "Finish", icon: FlagTriangleRight },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** The trip's days (YYYY-MM-DD), first to last. */
export function tripDays(t: FieldTrip) {
  if (!t.start_date) return [localDate()];
  const out: string[] = [];
  const start = new Date(`${t.start_date}T12:00:00`);
  for (let i = 0; i < Math.max(1, Math.min(t.days || 1, 60)); i++) out.push(localDate(new Date(start.getTime() + i * 86400000)));
  return out;
}

export function TripView({ trip, onBack }: { trip: FieldTrip; onBack: () => void }) {
  const { bundle } = useField();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (sessionStorage.getItem(`ambit-field-tab-${trip.id}`) as Tab) || "time";
    } catch {
      return "time";
    }
  });
  const days = tripDays(trip);
  const today = localDate();
  const [day, setDay] = useState(days.includes(today) ? today : today > days[days.length - 1] ? days[days.length - 1] : days[0]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`ambit-field-tab-${trip.id}`, tab);
    } catch {
      /* private mode */
    }
  }, [tab, trip.id]);
  const finished = (trip.wo?.status ?? "open") !== "open";

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="iconbtn" aria-label="Back to trips" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <span className="col tight grow" style={{ minWidth: 0 }}>
          <span className="tiny faint">Job #{trip.job.number}{trip.seq > 1 ? `-${trip.seq}` : ""} · {trip.name}</span>
          <b className="ellipsis" style={{ fontSize: 18 }}>{trip.customer.name}</b>
        </span>
        {finished ? <span className="pill ok">{trip.wo?.status === "reviewed" ? "Reviewed" : "Finished"}</span> : null}
      </div>

      <section className="card col fld-head" style={{ gap: 6 }}>
        {trip.address ? <span className="small"><MapPin size={14} style={{ verticalAlign: -2 }} /> {trip.address}</span> : null}
        <span className="tiny faint">
          {dayLabel(trip.start_date)}{trip.days > 1 ? ` – ${dayLabel(trip.end_date)}` : ""}{trip.start_time ? ` · start ${trip.start_time.slice(0, 5)}` : ""}
          {trip.rig ? <> · <Truck size={12} style={{ verticalAlign: -2 }} /> {trip.rig.name}</> : null}
        </span>
        {trip.gate_code ? <span className="small"><KeyRound size={14} style={{ verticalAlign: -2 }} /> Gate code <b>{trip.gate_code}</b></span> : null}
        {trip.job.crew_notes || trip.notes || trip.property_notes ? (
          <span className="small fld-note">{[trip.job.crew_notes, trip.notes, trip.property_notes].filter(Boolean).join(" · ")}</span>
        ) : null}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {trip.customer.phone ? <a className="btn sm dark" href={`tel:${trip.customer.phone}`}><Phone size={15} /> Call</a> : null}
          {trip.address ? <a className="btn sm dark" href={`https://maps.google.com/?q=${encodeURIComponent(trip.address)}`} target="_blank" rel="noopener"><MapPin size={15} /> Map</a> : null}
        </div>
      </section>

      <nav className="fld-tabs" aria-label="Work order">
        {TABS.map((t) => {
          const I = t.icon;
          return (
            <button key={t.key} type="button" className={tab === t.key ? "on" : ""} aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}>
              <I size={17} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {days.length > 1 && (tab === "material" || tab === "log" || tab === "areas" || tab === "photos") ? (
        <div className="chips fld-days" role="radiogroup" aria-label="Day">
          {days.map((d, i) => (
            <button key={d} type="button" className={`chip sm${day === d ? " on" : ""}`} aria-pressed={day === d} onClick={() => setDay(d)}>
              Day {i + 1}{d === today ? " · today" : ""}
            </button>
          ))}
        </div>
      ) : null}

      {finished ? (
        <div className="alert info small">
          <span>
            Finished {trip.wo?.finished_at ? new Date(trip.wo.finished_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
            {trip.wo?.finished_by_name ? ` by ${trip.wo.finished_by_name}` : ""}. {bundle.office ? "Reopen it from the job page to change it." : "Time punches can still be sent; ask the office to reopen it for anything else."}
          </span>
        </div>
      ) : null}

      {tab === "time" ? <TimeTab trip={trip} /> : null}
      {tab === "material" ? <MaterialTab trip={trip} day={day} /> : null}
      {tab === "log" ? <LogTab trip={trip} day={day} /> : null}
      {tab === "areas" ? <AreasTab trip={trip} day={day} /> : null}
      {tab === "photos" ? <PhotosTab trip={trip} day={day} /> : null}
      {tab === "finish" ? <FinishTab trip={trip} goTo={(t) => setTab(t as Tab)} /> : null}
    </div>
  );
}
