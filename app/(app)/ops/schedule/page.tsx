import Link from "next/link";
import { ChevronLeft, ChevronRight, Hammer, Package, PackageCheck, Truck } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { LINE_COLS, TRIP_COLS, loadCrew, loadRigCrew, loadRigs, toLine } from "@/lib/ops/jobs-server";
import { addDays, isDay, todayCentral, weekStart, type Trip } from "@/lib/ops/schedule";
import { TopBar } from "@/components/ui";
import { RigBoard, type BoardTrip } from "./board";

export const metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

type TripRow = Trip & {
  job: { id: string; number: number; status: string; title: string | null; customer: { name: string } | null; property: { street: string | null; city: string | null } | null } | null;
};

/** "November 2 – 8, 2026" or "October 26 – November 1, 2026" */
function weekText(from: string, to: string) {
  const d = (x: string, o: Intl.DateTimeFormatOptions) => new Date(`${x}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${d(from, { month: "long", day: "numeric" })} – ${d(to, { day: "numeric" })}, ${to.slice(0, 4)}`
    : `${d(from, { month: "long", day: "numeric" })} – ${d(to, { month: "long", day: "numeric" })}, ${to.slice(0, 4)}`;
}

const SEL = `${TRIP_COLS}, job:ops_jobs!inner(id, number, status, title, customer:ops_customers(name), property:ops_properties(street, city))`;

/** The rig board: rigs down the side, a week across, and the sold work that isn't scheduled yet. */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.jobs);
  const today = todayCentral();
  const from = weekStart(isDay(sp.d) ? sp.d : today);
  const to = addDays(from, 6);
  const co = ws.company.id;

  const [rigs, crew, rigCrew, { data: onBoard }, { data: waiting }] = await Promise.all([
    loadRigs(supabase, co),
    loadCrew(supabase, co),
    loadRigCrew(supabase, co),
    supabase.from("ops_trips").select(SEL).eq("company_id", co).in("status", ["scheduled", "in_progress", "done"]).lte("start_date", to).gte("end_date", from).order("start_date"),
    supabase.from("ops_trips").select(SEL).eq("company_id", co).eq("status", "unscheduled").eq("job.status", "open").order("created_at").limit(200),
  ]);
  const rows = [...((onBoard ?? []) as unknown as TripRow[]), ...((waiting ?? []) as unknown as TripRow[])].filter((t) => t.job && t.job.status !== "cancelled");
  // A trip opened from a job page that's on another week.
  if (sp.trip && /^[0-9a-f-]{36}$/i.test(sp.trip) && !rows.some((t) => t.id === sp.trip)) {
    const { data: one } = await supabase.from("ops_trips").select(SEL).eq("id", sp.trip).maybeSingle();
    if (one) rows.push(one as unknown as TripRow);
  }
  const ids = rows.map((t) => t.id);
  const [{ data: lineRows }, { data: crewRows }] = ids.length
    ? await Promise.all([
        supabase.from("ops_job_lines").select(LINE_COLS).in("trip_id", ids),
        supabase.from("ops_trip_crew").select("trip_id, crew_id, lead").in("trip_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const lines = (lineRows ?? []).map((r) => toLine(r as Record<string, unknown>));
  const trips: BoardTrip[] = rows.map((t) => ({
    ...t,
    job_number: t.job?.number ?? 0,
    job_title: t.job?.title ?? null,
    customer: t.job?.customer?.name ?? "Customer",
    place: [t.job?.property?.street, t.job?.property?.city].filter(Boolean).join(", "),
    lines: lines.filter((l) => l.trip_id === t.id),
    crew: ((crewRows ?? []) as { trip_id: string; crew_id: string; lead: boolean }[]).filter((c) => c.trip_id === t.id).map((c) => ({ crew_id: c.crew_id, lead: c.lead })),
  }));
  const dispatch = opsCan.dispatch(ws.role);

  return (
    <main className="shell full">
      <TopBar
        title="Schedule"
        back="/ops"
        right={
          <span className="row sched-top" style={{ gap: 8, marginLeft: "auto" }}>
            <Link href="/ops/jobs" className="btn sm dark"><Hammer size={15} /> <span>Jobs</span></Link>
            {dispatch ? <Link href="/ops/stock" className="btn sm dark"><Package size={15} /> <span>Stock</span></Link> : null}
            {dispatch ? <Link href="/ops/schedule/rigs" className="btn sm dark"><Truck size={15} /> <span>Rigs and crews</span></Link> : null}
          </span>
        }
      />
      <div className="sched-nav">
        <Link href={`/ops/schedule?d=${addDays(from, -7)}`} className="iconbtn" aria-label="Last week"><ChevronLeft size={20} /></Link>
        <b>{weekText(from, to)}</b>
        <Link href={`/ops/schedule?d=${addDays(from, 7)}`} className="iconbtn" aria-label="Next week"><ChevronRight size={20} /></Link>
        {from !== weekStart(today) ? <Link href="/ops/schedule" className="linkbtn small">This week</Link> : null}
        {dispatch ? (
          <Link href={`/ops/stock/check?from=${from}&to=${to}`} className="btn sm dark" style={{ marginLeft: "auto" }}><PackageCheck size={15} /> Stock check for this week</Link>
        ) : null}
      </div>
      <RigBoard
        from={from}
        today={today}
        rigs={rigs}
        crew={crew}
        rigCrew={Object.fromEntries([...rigCrew.entries()])}
        trips={trips}
        dispatch={dispatch}
        openTrip={sp.trip ?? null}
      />
    </main>
  );
}
