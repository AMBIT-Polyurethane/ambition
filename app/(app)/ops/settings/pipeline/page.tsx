import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { CLOSED } from "@/lib/ops/defaults";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { savePipeline } from "../actions";
import { AreaRows, StageRows } from "./editors";

export const metadata = { title: "Pipeline and lists" };
export const dynamic = "force-dynamic";

export default async function PipelineSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { ws } = await requireOps(opsCan.manage);
  const s = ws.settings;
  const won = s.stages.find((x) => x.key === "won")!;
  const lost = s.stages.find((x) => x.key === "lost")!;
  return (
    <SettingsShell title="Pipeline and lists" sp={sp}>
      <form action={savePipeline} className="col" style={{ gap: 14 }}>
        <section className="card col" style={{ gap: 10 }}>
          <b>Lead stages</b>
          <span className="tiny faint">The steps a lead moves through, left to right on the Leads board. Won and Lost are always last.</span>
          <StageRows stages={s.stages.filter((x) => !CLOSED.includes(x.key))} />
          <div className="grid2">
            <label className="field">
              <span className="label">Won is called</span>
              <input className="input sm" name="won_name" defaultValue={won.name} maxLength={40} />
            </label>
            <label className="field">
              <span className="label">Lost is called</span>
              <input className="input sm" name="lost_name" defaultValue={lost.name} maxLength={40} />
            </label>
          </div>
        </section>

        <section className="card col" style={{ gap: 10 }}>
          <b>Work areas</b>
          <span className="tiny faint">How a house is split up on takeoffs and quotes. The code shows on plans and work orders.</span>
          <AreaRows areas={s.work_areas} />
        </section>

        <section className="card col" style={{ gap: 12 }}>
          <label className="field">
            <span className="label">Lead sources (one per line)</span>
            <textarea className="textarea" name="sources" rows={6} defaultValue={s.sources.join("\n")} />
          </label>
          <label className="field">
            <span className="label">Reasons a lead is lost (one per line)</span>
            <textarea className="textarea" name="lost_reasons" rows={5} defaultValue={s.lost_reasons.join("\n")} />
          </label>
          <label className="field">
            <span className="label">Services you offer (one per line; shown on your lead form)</span>
            <textarea className="textarea" name="services" rows={6} defaultValue={s.services.join("\n")} />
          </label>
        </section>
        <Submit className="btn" pendingText="Saving…">Save</Submit>
      </form>
    </SettingsShell>
  );
}
