import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can, hubLock } from "@/lib/access";
import { inventoryBranches } from "@/lib/widgets";
import { loadHub } from "@/lib/inventory/hub";
import { REPORTS, buildReport, type ReportKey } from "@/lib/inventory/reports";
import { Empty, TopBar } from "@/components/ui";
import { HubNav, hubHome } from "@/components/inventory/hub-nav";
import { ReportTable } from "@/components/inventory/report-table";

export const metadata = { title: "Inventory reports" };
export const dynamic = "force-dynamic";


/** One report at a time, for a location or all of them, with a CSV download. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!can(profile, "inv_reports")) redirect(hubHome(profile, sp.b) ?? "/");
  const live = await inventoryBranches(supabase, profile);
  const key = (REPORTS.find((r) => r.key === sp.r)?.key ?? "reorder") as ReportKey;
  const pick = hubLock(profile) !== null
    ? live[0]?.id ?? "none" // warehouse managers: their own location only
    : sp.b === "all" || !sp.b ? (sp.b === "all" || !live.some((b) => b.id === profile.branch_id) ? "all" : profile.branch_id!) : live.find((b) => b.id === sp.b)?.id ?? "all";
  if (!live.length) return <main className="shell"><TopBar title="Reports" back="/inventory" /><Empty icon="boxes" title="No inventory spreadsheet is connected yet" /></main>;
  const hub = await loadHub(supabase, pick === "all" ? "all" : [pick]);
  const rep = buildReport(hub, key);
  const meta = REPORTS.find((r) => r.key === key)!;
  const moneyCol = rep.head.map((h, c) => rep.num[c] && /value|\$|sell price/i.test(h));

  return (
    <main className="shell wide">
      <TopBar title="Reports" back={`/inventory?b=${pick}`} />
      <HubNav profile={profile} active="reports" branch={pick} />
      <div className="chips" role="tablist" aria-label="Report">
        {REPORTS.map((r) => (
          <Link key={r.key} href={`/inventory/reports?r=${r.key}&b=${pick}`} className={`chip sm${r.key === key ? " on" : ""}`}>{r.label}</Link>
        ))}
      </div>
      {live.length > 1 ? (
        <div className="chips" aria-label="Location">
          <Link href={`/inventory/reports?r=${key}&b=all`} className={`chip sm${pick === "all" ? " on2" : ""}`}>All locations</Link>
          {live.map((b) => (
            <Link key={b.id} href={`/inventory/reports?r=${key}&b=${b.id}`} className={`chip sm${b.id === pick ? " on2" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>{meta.hint}</p>
      {rep.rows.length ? (
        <ReportTable
          key={`${key}-${pick}`}
          head={rep.head}
          num={rep.num}
          money={moneyCol}
          rows={rep.rows}
          flag={rep.flag}
          total={rep.total}
          fileName={`inventory-${key}-${pick === "all" ? "all-locations" : pick}-${hub.today}.csv`}
        />
      ) : (
        <Empty icon="layers" title="Nothing to show yet">This fills in as orders, deliveries and counts go through the app.</Empty>
      )}
      {rep.note ? <p className="tiny faint" style={{ margin: 0 }}>{rep.note}</p> : null}
    </main>
  );
}
