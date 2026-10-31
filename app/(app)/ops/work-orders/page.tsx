import Link from "next/link";
import { ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, Smartphone } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { TopBar } from "@/components/ui";
import { dateShort } from "@/lib/format";

export const metadata = { title: "Work orders" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "review", label: "To review", statuses: ["done"] },
  { key: "open", label: "In progress", statuses: ["open"] },
  { key: "waiting", label: "Not started", statuses: [] },
  { key: "reviewed", label: "Reviewed", statuses: ["reviewed"] },
] as const;

type Row = {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  sprayer_name: string | null;
  issue: string | null;
  updated_at: string;
  trip: { id: string; name: string; seq: number; start_date: string | null; end_date: string | null; rig: { name: string } | null } | null;
  job: { id: string; number: number; title: string | null; customer: { name: string } | null } | null;
};

/** The office's list: finished work orders to review, the ones crews are working on, and trips not started. */
export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.jobs);
  const co = ws.company.id;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const [{ count: nReview }, { count: nOpen }, { data: woTrips }, { data: started }] = await Promise.all([
    supabase.from("ops_work_orders").select("id", { count: "exact", head: true }).eq("company_id", co).eq("status", "done"),
    supabase.from("ops_work_orders").select("id", { count: "exact", head: true }).eq("company_id", co).eq("status", "open"),
    supabase.from("ops_trips").select("id, name, seq, start_date, end_date, rig:ops_rigs(name), job:ops_jobs!inner(id, number, title, status, customer:ops_customers(name))").eq("company_id", co).eq("status", "scheduled").lte("start_date", today).eq("job.status", "open").order("start_date").limit(100),
    supabase.from("ops_work_orders").select("trip_id").eq("company_id", co),
  ]);
  const hasWo = new Set(((started ?? []) as { trip_id: string }[]).map((r) => r.trip_id));
  type T = { id: string; name: string; seq: number; start_date: string | null; end_date: string | null; rig: { name: string } | null; job: { id: string; number: number; title: string | null; customer: { name: string } | null } | null };
  const waiting = ((woTrips ?? []) as unknown as T[]).filter((t) => !hasWo.has(t.id));

  let rows: Row[] = [];
  if (tab.key !== "waiting") {
    const { data } = await supabase
      .from("ops_work_orders")
      .select("id, status, started_at, finished_at, sprayer_name, issue, updated_at, trip:ops_trips(id, name, seq, start_date, end_date, rig:ops_rigs(name)), job:ops_jobs(id, number, title, customer:ops_customers(name))")
      .eq("company_id", co)
      .in("status", tab.statuses as unknown as string[])
      .order(tab.key === "open" ? "updated_at" : "finished_at", { ascending: false })
      .limit(200);
    rows = (data ?? []) as unknown as Row[];
  }
  const count = (k: string) => (k === "review" ? nReview ?? 0 : k === "open" ? nOpen ?? 0 : k === "waiting" ? waiting.length : null);

  return (
    <main className="shell wide">
      <TopBar title="Work orders" back="/ops" right={<Link href="/ops/field" className="btn sm dark"><Smartphone size={15} /> Field view</Link>} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <p className="small muted" style={{ margin: 0 }}>
        Crews fill these in on their phones (time, sets and lots, the spray log, photos, the customer&apos;s signature), even with no signal. Review each one when it&apos;s finished.
      </p>

      <div className="chips wrap" role="tablist">
        {TABS.map((t) => {
          const n = count(t.key);
          return (
            <Link key={t.key} href={`/ops/work-orders?tab=${t.key}`} className={`chip${t.key === tab.key ? " on" : ""}`} role="tab" aria-selected={t.key === tab.key}>
              {t.label}{n ? ` (${n})` : ""}
            </Link>
          );
        })}
      </div>

      {tab.key === "waiting" ? (
        waiting.length ? (
          <div className="list">
            {waiting.map((t) => (
              <Link key={t.id} href={t.job ? `/ops/jobs/${t.job.id}` : "/ops/schedule"} className="item">
                <div className="ic"><ClipboardCheck size={18} /></div>
                <div className="grow">
                  <div className="t">{t.job?.customer?.name ?? "Customer"} · Job #{t.job?.number}{t.seq > 1 ? `-${t.seq}` : ""}</div>
                  <div className="s">{t.name} · {t.start_date ? dateShort(t.start_date) : ""}{t.rig ? ` · ${t.rig.name}` : ""} · the crew hasn&apos;t started it</div>
                </div>
                <ChevronRight size={18} className="chev" />
              </Link>
            ))}
          </div>
        ) : <div className="alert info small"><span>Every trip that should have started has a work order.</span></div>
      ) : rows.length ? (
        <div className="list">
          {rows.map((r) => (
            <Link key={r.id} href={`/ops/work-orders/${r.id}`} className="item">
              <div className="ic">{r.issue ? <CircleAlert size={18} className="warn-text" /> : <ClipboardCheck size={18} />}</div>
              <div className="grow">
                <div className="t">{r.job?.customer?.name ?? "Customer"} · Job #{r.job?.number}{(r.trip?.seq ?? 1) > 1 ? `-${r.trip?.seq}` : ""}</div>
                <div className="s">
                  {r.trip?.name ?? "Trip"}{r.trip?.rig ? ` · ${r.trip.rig.name}` : ""} · {r.finished_at ? `finished ${dateShort(r.finished_at)}` : r.started_at ? `started ${dateShort(r.started_at)}` : "not started"}
                  {r.sprayer_name ? ` · ${r.sprayer_name}` : ""}{r.issue ? " · issue reported" : ""}
                </div>
              </div>
              <ChevronRight size={18} className="chev" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="alert info small"><span>{tab.key === "review" ? "Nothing waiting for review." : tab.key === "open" ? "No crew is working on a work order right now." : "No reviewed work orders yet."}</span></div>
      )}
    </main>
  );
}
