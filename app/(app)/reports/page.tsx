import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { reportHref, reportsElsewhere, reportsFor, type ReportDef } from "@/lib/reports";
import { Icon } from "@/components/icons";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/** Reports: every report this person can open, by area. Ones the app doesn't have the data for yet say Coming soon. */
export default async function ReportsPage() {
  const { profile } = await requireActive();
  if (!isEmployee(profile)) redirect("/");
  const groups = reportsFor(profile);
  const other = reportsElsewhere(profile);
  const card = (r: Pick<ReportDef, "key" | "title" | "blurb" | "icon" | "soon"> & { href: string }) =>
    r.soon ? (
      <div key={r.key} className="item report-card soon" aria-disabled="true">
        <span className="report-ico" aria-hidden="true"><Icon name={r.icon} size={20} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <span className="t">{r.title} <span className="pill grey report-soon">Coming soon</span></span>
          <div className="s">{r.blurb}</div>
          <div className="tiny faint" style={{ marginTop: 4 }}>{r.soon}</div>
        </div>
      </div>
    ) : (
      <Link key={r.key} href={r.href} className="item report-card">
        <span className="report-ico" aria-hidden="true"><Icon name={r.icon} size={20} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <span className="t">{r.title}</span>
          <div className="s">{r.blurb}</div>
        </div>
        <ChevronRight size={18} className="chev" />
      </Link>
    );
  return (
    <main className="shell">
      <TopBar title="Reports" back="/" />
      {groups.map(({ group, reports }) => {
        const more = other.filter((o) => o.group === group.key);
        return (
          <section key={group.key} className="col" style={{ gap: 8 }}>
            <div className="eyebrow">{group.label}</div>
            <div className="list">
              {reports.map((r) => card({ ...r, href: reportHref(r) }))}
              {more.map((o) => card({ ...o, soon: undefined }))}
            </div>
          </section>
        );
      })}
      {other.filter((o) => !groups.some((g) => g.group.key === o.group)).length ? (
        <div className="list">{other.filter((o) => !groups.some((g) => g.group.key === o.group)).map((o) => card({ ...o, soon: undefined }))}</div>
      ) : null}
    </main>
  );
}
