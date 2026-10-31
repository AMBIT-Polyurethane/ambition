import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange, ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, FileSignature, MapPin, Phone, SquareKanban } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { addressOf, loadCrew, loadJob, loadRigs } from "@/lib/ops/jobs-server";
import { money } from "@/lib/ops/quote-calc";
import { dateShort } from "@/lib/format";
import { Submit } from "@/components/forms";
import { TopBar } from "@/components/ui";
import { cancelJob, reopenJob, saveJobNotes } from "../../schedule/actions";
import { JobTrips } from "./job-trips";

export const metadata = { title: "Job" };
export const dynamic = "force-dynamic";

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.jobs);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const loaded = await loadJob(supabase, id);
  if (!loaded) notFound();
  const { job, trips, lines, tripCrew } = loaded;
  const [rigs, crew, { data: woRows }] = await Promise.all([
    loadRigs(supabase, ws.company.id, true),
    loadCrew(supabase, ws.company.id, true),
    supabase.from("ops_work_orders").select("id, trip_id, status, started_at, finished_at, issue").eq("job_id", id),
  ]);
  const wos = (woRows ?? []) as { id: string; trip_id: string; status: string; started_at: string | null; finished_at: string | null; issue: string | null }[];
  const dispatch = opsCan.dispatch(ws.role);
  const addr = addressOf(job.property);
  const cancelled = job.status === "cancelled";
  return (
    <main className="shell wide">
      <TopBar title={`Job #${job.number}`} back="/ops/jobs" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      {cancelled ? <div className="alert warn small"><span>This job is cancelled. Its trips are off the board.</span></div> : null}

      <div className="job-grid">
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <section className="card col" style={{ gap: 8 }}>
            <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
              <span className="col tight" style={{ minWidth: 0 }}>
                <span className="eyebrow">{job.title || "Job"}</span>
                <b style={{ fontSize: 20 }}>{job.customer?.name ?? "Customer"}</b>
                {addr ? <span className="small muted">{addr}</span> : null}
              </span>
              {job.sold_total !== null ? <span className="col tight" style={{ textAlign: "right" }}><span className="tiny faint">Sold</span><b>{money(job.sold_total)}</b></span> : null}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {job.customer?.phone ? <a className="btn sm dark" href={`tel:${job.customer.phone}`}><Phone size={15} /> Call</a> : null}
              {addr ? <a className="btn sm dark" href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noopener"><MapPin size={15} /> Map</a> : null}
              {job.quote_id ? <Link className="btn sm dark" href={`/ops/quotes/${job.quote_id}`}><FileSignature size={15} /> Quote #{job.quote?.number}</Link> : null}
              {job.lead_id ? <Link className="btn sm dark" href={`/ops/leads/${job.lead_id}`}><SquareKanban size={15} /> Lead</Link> : null}
              <Link className="btn sm" href="/ops/schedule"><CalendarRange size={15} /> Schedule</Link>
            </div>
            {job.property?.gate_code || job.property?.notes ? (
              <span className="small muted">{job.property?.gate_code ? <>Gate code <b>{job.property.gate_code}</b>. </> : null}{job.property?.notes ?? ""}</span>
            ) : null}
            <span className="tiny faint">Sold {dateShort(job.created_at)}</span>
          </section>

          <JobTrips
            trips={trips}
            lines={lines}
            tripCrew={tripCrew}
            rigs={rigs}
            crew={crew}
            dispatch={dispatch && !cancelled}
          />
        </div>

        <aside className="col" style={{ gap: 14, minWidth: 0 }}>
          {trips.some((t) => t.status !== "unscheduled" && t.status !== "cancelled") ? (
            <section className="card col" style={{ gap: 8 }}>
              <b><ClipboardCheck size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Work orders</b>
              {trips.filter((t) => t.status !== "unscheduled" && t.status !== "cancelled").map((t) => {
                const w = wos.find((x) => x.trip_id === t.id);
                return w ? (
                  <Link key={t.id} href={`/ops/work-orders/${w.id}`} className="row between small" style={{ gap: 8, color: "inherit" }}>
                    <span className="ellipsis">{t.name}{w.issue ? " · issue" : ""}</span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className={`pill ${w.status === "open" ? "warn" : "ok"}`}>{w.status === "open" ? "In progress" : w.status === "done" ? "To review" : "Reviewed"}</span>
                      <ChevronRight size={15} className="faint" />
                    </span>
                  </Link>
                ) : (
                  <div key={t.id} className="row between small" style={{ gap: 8 }}>
                    <span className="ellipsis">{t.name}</span>
                    <span className="pill grey">Not started</span>
                  </div>
                );
              })}
              <span className="tiny faint">The crew fills these in on their phones (Work orders), even with no signal.</span>
            </section>
          ) : null}
          <form action={saveJobNotes} className="card col" style={{ gap: 8 }}>
            <input type="hidden" name="id" value={job.id} />
            <b>Notes for the crew</b>
            <span className="tiny faint">Shown on every trip of this job: where to park, pets, who lets them in. No prices are shown to crews.</span>
            <textarea className="input" name="crew_notes" rows={4} maxLength={2000} defaultValue={job.crew_notes ?? ""} disabled={!dispatch} placeholder="Park on the street. Dog in the back yard." />
            {dispatch ? <Submit className="btn sm dark" pendingText="Saving…">Save notes</Submit> : null}
          </form>
          {dispatch ? (
            <section className="card col" style={{ gap: 8 }}>
              <b>{cancelled ? "Open it again" : "Customer called it off?"}</b>
              <form action={cancelled ? reopenJob : cancelJob}>
                <input type="hidden" name="id" value={job.id} />
                <Submit className={`btn sm ${cancelled ? "dark" : "ghost danger-text"}`} pendingText="…">{cancelled ? "Reopen this job" : "Cancel this job"}</Submit>
              </form>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
