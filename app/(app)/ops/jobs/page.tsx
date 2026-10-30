import Link from "next/link";
import { CalendarRange, ChevronRight, Hammer, Package, Search, Truck } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { money } from "@/lib/ops/quote-calc";
import { rangeText, todayCentral, type TripStatus } from "@/lib/ops/schedule";
import { dateShort } from "@/lib/format";
import { Empty, TopBar } from "@/components/ui";

export const metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { id: "todo", label: "Not scheduled" },
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

type Row = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  sold_total: number | null;
  created_at: string;
  customer: { name: string } | null;
  property: { street: string | null; city: string | null } | null;
  trips: { id: string; status: TripStatus; start_date: string | null; days: number; name: string }[];
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.jobs);
  const f = FILTERS.some((x) => x.id === sp.f) ? sp.f! : "open";
  const q = (sp.q ?? "").trim().replace(/[\\%_,()]/g, " ").slice(0, 80);
  let query = supabase
    .from("ops_jobs")
    .select("id, number, title, status, sold_total, created_at, customer:ops_customers(name), property:ops_properties(street, city), trips:ops_trips(id, status, start_date, days, name)")
    .eq("company_id", ws.company.id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (f === "open" || f === "todo") query = query.eq("status", "open");
  if (f === "done") query = query.eq("status", "done");
  if (f === "cancelled") query = query.eq("status", "cancelled");
  if (q) {
    const num = Number(q.replace(/^#/, ""));
    query = Number.isInteger(num) && num > 0 ? query.eq("number", num) : query.ilike("title", `%${q}%`);
  }
  const { data } = await query;
  let rows = (data ?? []) as unknown as Row[];
  if (f === "todo") rows = rows.filter((r) => r.trips.some((t) => t.status === "unscheduled"));
  const today = todayCentral();
  const dispatch = opsCan.dispatch(ws.role);
  return (
    <main className="shell wide">
      <TopBar
        title="Jobs"
        back="/ops"
        right={
          <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
            {dispatch ? <Link href="/ops/stock" className="btn sm dark"><Package size={15} /> Stock</Link> : null}
            {dispatch ? <Link href="/ops/schedule/rigs" className="btn sm dark"><Truck size={15} /> Rigs and crews</Link> : null}
            <Link href="/ops/schedule" className="btn sm"><CalendarRange size={15} /> Schedule</Link>
          </span>
        }
      />
      <form className="search" action="/ops/jobs">
        <input type="hidden" name="f" value={f} />
        <Search size={18} />
        <input className="input" type="search" name="q" defaultValue={q} placeholder="Job # or name" aria-label="Find a job" />
      </form>
      <div className="chips">
        {FILTERS.map((x) => (
          <Link key={x.id} href={`/ops/jobs?f=${x.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${f === x.id ? " on" : ""}`}>{x.label}</Link>
        ))}
      </div>
      {rows.length ? (
        <div className="list">
          {rows.map((r) => {
            const live = r.trips.filter((t) => t.status !== "cancelled");
            const waiting = live.filter((t) => t.status === "unscheduled").length;
            const next = live.filter((t) => t.start_date && (t.status === "scheduled" || t.status === "in_progress")).sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1)).find((t) => t.start_date! >= today) ?? null;
            const addr = [r.property?.street, r.property?.city].filter(Boolean).join(", ");
            return (
              <Link key={r.id} href={`/ops/jobs/${r.id}`} className="item">
                <div className="ic"><Hammer size={17} /></div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">#{r.number} · {r.customer?.name ?? "Customer"}</div>
                  <div className="s ellipsis">
                    {[addr, `${live.length} trip${live.length === 1 ? "" : "s"}`, waiting ? `${waiting} not scheduled` : next ? `next ${rangeText(next.start_date, next.days)}` : r.status === "done" ? "done" : null, `sold ${dateShort(r.created_at)}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {r.sold_total !== null ? <span className="small">{money(r.sold_total)}</span> : null}
                {waiting && r.status === "open" ? <span className="pill warn">To schedule</span> : r.status === "cancelled" ? <span className="pill grey">Cancelled</span> : null}
                <ChevronRight size={18} className="chev" />
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty title={f === "todo" ? "Everything sold is on the board" : "No jobs here"}>
          A job is made by itself when a customer signs a quote. Its work starts in one trip, ready to put on a rig.
        </Empty>
      )}
    </main>
  );
}
