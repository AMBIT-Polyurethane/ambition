import { ClipboardCheck } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { MEASURE_UNITS } from "@/lib/ops/defaults";
import { saveWorkOrderSettings } from "../../work-orders/actions";

export const metadata = { title: "Work orders" };
export const dynamic = "force-dynamic";

export default async function WorkOrderSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { ws } = await requireOps(opsCan.manage);
  const raw = (ws.company.ops_settings ?? {}) as Record<string, unknown>;
  const share = raw.share_logs !== false;
  const unit = MEASURE_UNITS.find((m) => m.key === ws.settings.measure_unit);
  return (
    <SettingsShell title="Work orders" sp={sp}>
      <section className="card col" style={{ gap: 12 }}>
        <b><ClipboardCheck size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Send finished spray logs to AMBIT</b>
        <span className="small muted">
          When a crew finishes a work order, AMBIT tech support gets a read-only copy of the spray log: readings, lots, sets and yield, photos and the sign-off. It helps AMBIT stand behind the foam (warranty and complaints) and compare yields. No prices, and never your customer&apos;s phone or email.
        </span>
        <form action={saveWorkOrderSettings} className="col" style={{ gap: 10 }}>
          <label className="check"><input type="checkbox" name="share_logs" defaultChecked={share} /> Send finished spray logs to AMBIT tech support</label>
          <Submit className="btn sm" pendingText="Saving…">Save</Submit>
        </form>
        <span className="tiny faint">Changing this affects work orders finished from now on.</span>
      </section>
      <section className="card col" style={{ gap: 6 }}>
        <b>How crews enter foam</b>
        <span className="small muted">{unit ? `${unit.label}: ${unit.hint}.` : ""} Sets used are typed on every material line (worked out from pounds when you measure in pounds). Change it in Pricing, margins and labor.</span>
      </section>
    </SettingsShell>
  );
}
