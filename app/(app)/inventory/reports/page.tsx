import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { inventoryBranches } from "@/lib/widgets";
import { loadHub } from "@/lib/inventory/hub";
import { REPORTS, buildReport, type Cell, type ReportKey } from "@/lib/inventory/reports";
import { Empty, TopBar } from "@/components/ui";
import { HubNav, hubHome } from "@/components/inventory/hub-nav";

export const metadata = { title: "Inventory reports" };
export const dynamic = "force-dynamic";

const show = (v: Cell, money: boolean) => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return money ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y: string, m: string, d: string) => `${Number(m)}/${Number(d)}/${y.slice(2)}`);
};

/** One report at a time, for a location or all of them, with a CSV download. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!can(profile, "inv_reports")) redirect(hubHome(profile, sp.b) ?? "/");
  const live = await inventoryBranches(supabase, profile);
  const key = (REPORTS.find((r) => r.key === sp.r)?.key ?? "reorder") as ReportKey;
  const pick = sp.b === "all" || !sp.b ? (sp.b === "all" || !live.some((b) => b.id === profile.branch_id) ? "all" : profile.branch_id!) : live.find((b) => b.id === sp.b)?.id ?? "all";
  if (!live.length) return <main className="shell"><TopBar title="Reports" back="/inventory" /><Empty icon="boxes" title="No inventory spreadsheet is connected yet" /></main>;
  const hub = await loadHub(supabase, pick === "all" ? "all" : [pick]);
  const rep = buildReport(hub, key);
  const meta = REPORTS.find((r) => r.key === key)!;
  const moneyCol = rep.head.map((h) => /value|\$|sell price/i.test(h));

  return (
    <main className="shell wide">
      <TopBar
        title="Reports"
        back={`/inventory?b=${pick}`}
        right={
          <a className="btn sm dark" href={`/inventory/reports/export?r=${key}&b=${pick}`} download>
            <Download size={15} /> CSV
          </a>
        }
      />
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
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>{rep.head.map((h, i) => <th key={i} className={rep.num[i] ? "num" : ""}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rep.rows.map((row, ri) => (
                <tr key={ri} className={rep.flag[ri] === "err" ? "err" : rep.flag[ri] ? "hl" : ""}>
                  {row.map((c, ci) => <td key={ci} className={rep.num[ci] ? "num" : ""}>{show(c, moneyCol[ci])}</td>)}
                </tr>
              ))}
            </tbody>
            {rep.total ? (
              <tfoot>
                <tr>{rep.total.map((c, ci) => <td key={ci} className={rep.num[ci] ? "num" : ""}>{show(c, moneyCol[ci])}</td>)}</tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : (
        <Empty icon="layers" title="Nothing to show yet">This fills in as orders, deliveries and counts go through the app.</Empty>
      )}
      {rep.note ? <p className="tiny faint" style={{ margin: 0 }}>{rep.note}</p> : null}
    </main>
  );
}
