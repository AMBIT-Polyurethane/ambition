import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { reportsElsewhere, reportsFor, type ReportCard } from "@/lib/reports";
import { Icon } from "@/components/icons";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/** Reports: every report this person can open, in one place. */
export default async function ReportsPage() {
  const { profile } = await requireActive();
  if (!isEmployee(profile)) redirect("/");
  const mine = reportsFor(profile);
  const other = reportsElsewhere(profile);
  const card = (r: ReportCard) => (
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
      <div className="list">{mine.map(card)}</div>
      {other.length ? (
        <>
          <div className="eyebrow">Also in the app</div>
          <div className="list">{other.map(card)}</div>
        </>
      ) : null}
    </main>
  );
}
