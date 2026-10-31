import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, FileDown, RotateCcw, Smartphone } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { loadWorkOrder, woLabel } from "@/lib/ops/work-orders-server";
import { WorkOrderView } from "@/components/ops/work-order-view";
import { Submit } from "@/components/forms";
import { TopBar } from "@/components/ui";
import { reopenWorkOrder, reviewWorkOrder } from "../actions";

export const metadata = { title: "Work order" };
export const dynamic = "force-dynamic";

export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.jobs);
  const d = await loadWorkOrder(supabase, id);
  if (!d || !d.mine) notFound();
  const dispatch = opsCan.dispatch(ws.role);
  const w = d.wo;
  return (
    <main className="shell wide">
      <TopBar title={`Work order · ${woLabel(d)}`} back="/ops/work-orders" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <a className="btn sm dark" href={`/ops/work-orders/${w.id}/pdf`} target="_blank" rel="noopener"><FileDown size={15} /> Spray log PDF</a>
        <Link className="btn sm dark" href={`/ops/jobs/${d.job.id}`}>Job #{d.job.number}</Link>
        {dispatch && w.status === "open" ? <Link className="btn sm dark" href={`/ops/field?trip=${d.trip.id}`}><Smartphone size={15} /> Open in field view</Link> : null}
      </div>

      {dispatch && w.status === "done" ? (
        <form action={reviewWorkOrder} className="card col" style={{ gap: 8 }}>
          <input type="hidden" name="id" value={w.id} />
          <input type="hidden" name="trip" value={d.trip.id} />
          <b>Review</b>
          <span className="small muted">Check the time, sets and lots, readings and photos. Something wrong? Reopen it so the crew (or you, in field view) can fix it.</span>
          <textarea className="input" name="note" rows={2} maxLength={1000} placeholder="Note for the crew (optional)" />
          <span><Submit className="btn sm" pendingText="Saving…">Mark reviewed</Submit></span>
        </form>
      ) : null}
      {dispatch && w.status !== "open" ? (
        <form action={reopenWorkOrder} className="row" style={{ gap: 8 }}>
          <input type="hidden" name="id" value={w.id} />
          <input type="hidden" name="trip" value={d.trip.id} />
          <Submit className="btn sm ghost" pendingText="…"><RotateCcw size={15} /> Reopen for the crew</Submit>
          <span className="tiny faint">Something to fix? Reopen it and the crew (or you, in field view) can change it.</span>
        </form>
      ) : null}
      {w.share_ambit ? <span className="tiny faint">A copy went to AMBIT tech support{w.ambit_seen_at ? " (they've opened it)" : ""}. Change this in Settings &gt; Work orders.</span> : null}

      <WorkOrderView d={d} />
    </main>
  );
}
