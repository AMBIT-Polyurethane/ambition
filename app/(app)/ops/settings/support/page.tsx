import { LifeBuoy } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { dateShort, dateTime } from "@/lib/format";
import { setSupport } from "../actions";

export const metadata = { title: "Let AMBIT help" };
export const dynamic = "force-dynamic";

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps((r) => r === "owner");
  const { data: log } = await supabase.from("ops_support_log").select("id, staff_name, action, at").eq("company_id", ws.company.id).order("at", { ascending: false }).limit(50);
  const until = ws.company.ops_support_until && Date.parse(ws.company.ops_support_until) > Date.now() ? ws.company.ops_support_until : null;
  return (
    <SettingsShell title="Let AMBIT help" sp={sp}>
      <section className="card col" style={{ gap: 12 }}>
        <b><LifeBuoy size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Your workspace is private</b>
        <span className="small muted">
          Your customers, prices and jobs are yours. AMBIT can&apos;t see them unless you turn this on, for example so AMBIT can help you set up or fix something. Every time someone from AMBIT opens your workspace, it shows below.
        </span>
        {until ? (
          <div className="alert ok small"><span>AMBIT can help until <b>{dateShort(until)}</b>.</span></div>
        ) : (
          <div className="alert info small"><span>AMBIT can&apos;t open your workspace right now.</span></div>
        )}
        <form action={setSupport} className="row wrap" style={{ gap: 8 }}>
          {until ? (
            <>
              <input type="hidden" name="days" value="0" />
              <Submit className="btn sm dark" pendingText="…">Turn off now</Submit>
            </>
          ) : (
            <>
              <select className="select sm" name="days" defaultValue="7" aria-label="For how long" style={{ maxWidth: 200 }}>
                <option value="1">For 1 day</option>
                <option value="7">For 7 days</option>
                <option value="30">For 30 days</option>
              </select>
              <Submit className="btn sm" pendingText="…">Let AMBIT help</Submit>
            </>
          )}
        </form>
      </section>
      <section className="col" style={{ gap: 8 }}>
        <div className="eyebrow">Visits and changes</div>
        {(log ?? []).length ? (
          <div className="list">
            {((log ?? []) as { id: number; staff_name: string | null; action: string; at: string }[]).map((l) => (
              <div key={l.id} className="item">
                <div className="grow">
                  <div className="t">{l.action === "opened" ? `${l.staff_name ?? "AMBIT"} opened your workspace` : `${l.staff_name ?? "You"} ${l.action === "turned off" ? "turned AMBIT help off" : `let AMBIT help (${l.action.replace("allowed ", "")})`}`}</div>
                  <div className="s">{dateTime(l.at)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="small muted">No visits yet.</span>
        )}
      </section>
    </SettingsShell>
  );
}
