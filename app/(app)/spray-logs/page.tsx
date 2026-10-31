import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, CircleAlert, NotebookPen } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { TopBar } from "@/components/ui";
import { dateShort } from "@/lib/format";

export const metadata = { title: "Contractor spray logs" };
export const dynamic = "force-dynamic";

type Log = {
  id: string;
  finished_at: string;
  seen_at: string | null;
  seen_by: string | null;
  company: string;
  job_number: number;
  trip_seq: number;
  customer: string;
  city: string | null;
  sprayer: string | null;
  issue: boolean;
  affected: string | null;
  tech_contacted: boolean | null;
  foam: string | null;
  sets: number | null;
};

/** AMBIT tech support: finished spray logs from AMBIT-OPS contractors who send them to AMBIT. */
export default async function SprayLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!can(profile, "spray_log")) redirect("/");
  const days = sp.days === "365" ? 365 : 90;
  const { data } = await supabase.rpc("ops_ambit_spray_logs", { p_days: days });
  const all = (data ?? []) as Log[];
  const show = sp.only === "issues" ? all.filter((l) => l.issue) : sp.only === "new" ? all.filter((l) => !l.seen_at) : all;
  const nIssues = all.filter((l) => l.issue).length;
  const nNew = all.filter((l) => !l.seen_at).length;
  const href = (only?: string) => `/spray-logs?${new URLSearchParams({ ...(only ? { only } : {}), ...(days === 365 ? { days: "365" } : {}) })}`;
  return (
    <main className="shell wide">
      <TopBar title="Contractor spray logs" back="/" />
      <p className="small muted" style={{ margin: 0 }}>
        Spray job data logs from AMBIT-OPS contractors who send finished logs to AMBIT (their setting). Readings, lots, yield, photos and sign-off for warranty, complaints and yield benchmarking.
      </p>
      <div className="chips wrap">
        <Link href={href()} className={`chip${!sp.only ? " on" : ""}`}>All ({all.length})</Link>
        <Link href={href("new")} className={`chip${sp.only === "new" ? " on" : ""}`}>Not opened ({nNew})</Link>
        <Link href={href("issues")} className={`chip${sp.only === "issues" ? " on" : ""}`}>Issues ({nIssues})</Link>
        <Link href={`/spray-logs?${new URLSearchParams({ ...(sp.only ? { only: sp.only } : {}), ...(days === 365 ? {} : { days: "365" }) })}`} className="chip">{days === 365 ? "Last 90 days" : "Last 12 months"}</Link>
      </div>
      {show.length ? (
        <div className="list">
          {show.map((l) => (
            <Link key={l.id} href={`/spray-logs/${l.id}`} className="item">
              <div className="ic">{l.issue ? <CircleAlert size={18} className="warn-text" /> : <NotebookPen size={18} />}</div>
              <div className="grow">
                <div className="t">{l.company} · {l.customer}{!l.seen_at ? <span className="pill info" style={{ marginLeft: 6 }}>New</span> : null}</div>
                <div className="s">
                  {dateShort(l.finished_at)} · Job #{l.job_number}{l.trip_seq > 1 ? `-${l.trip_seq}` : ""}{l.city ? ` · ${l.city}` : ""}{l.foam ? ` · ${l.foam}` : ""}{l.sets ? ` · ${Number(l.sets).toLocaleString("en-US", { maximumFractionDigits: 2 })} sets` : ""}
                  {l.sprayer ? ` · ${l.sprayer}` : ""}{l.issue ? ` · issue${l.affected === "yes" ? " (affected the foam)" : ""}${l.tech_contacted ? ", called AMBIT" : ""}` : ""}
                </div>
              </div>
              <ChevronRight size={18} className="chev" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="alert info small"><span>No spray logs here yet. They arrive when a contractor&apos;s crew finishes a work order in AMBIT-OPS.</span></div>
      )}
    </main>
  );
}
