import { notFound, redirect } from "next/navigation";
import { FileDown } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { loadWorkOrder, woLabel } from "@/lib/ops/work-orders-server";
import { WorkOrderView } from "@/components/ops/work-order-view";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Spray log" };
export const dynamic = "force-dynamic";

/** One contractor spray log, read-only, for AMBIT tech support. */
export default async function SprayLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireEmployee();
  if (!can(profile, "spray_log")) redirect("/");
  const d = await loadWorkOrder(supabase, id);
  if (!d || !d.wo.share_ambit) notFound();
  if (!d.wo.ambit_seen_at) await supabase.rpc("ops_wo_ambit_seen", { p_wo: id });
  return (
    <main className="shell wide">
      <TopBar title={`${d.company.brand} · ${woLabel(d)}`} back="/spray-logs" />
      <div className="row" style={{ gap: 8 }}>
        <a className="btn sm dark" href={`/spray-logs/${id}/pdf`} target="_blank" rel="noopener"><FileDown size={15} /> PDF</a>
        <span className="tiny faint">Sent to AMBIT by {d.company.name}. Read-only.</span>
      </div>
      <WorkOrderView d={d} />
    </main>
  );
}
