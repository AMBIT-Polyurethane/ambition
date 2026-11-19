import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { reportHref, reportsElsewhere, reportsFor } from "@/lib/reports";
import { ReportFinder } from "@/components/report-finder";
import type { Tile } from "@/components/tile-grid";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/** Reports: every report this person can open, by area, as tiles. Ones the app doesn't have the data for yet say Coming soon. */
export default async function ReportsPage() {
  const { profile } = await requireActive();
  if (!isEmployee(profile)) redirect("/");
  const groups = reportsFor(profile);
  const other = reportsElsewhere(profile);
  const tiles: { key: string; label: string; tiles: Tile[] }[] = groups.map(({ group, reports }) => ({
    key: group.key,
    label: group.label,
    tiles: [
      ...reports.map((r): Tile => ({ key: r.key, href: reportHref(r), icon: r.icon, title: r.title, sub: r.blurb, soon: r.soon })),
      ...other.filter((o) => o.group === group.key).map((o): Tile => ({ key: o.key, href: o.href, icon: o.icon, title: o.title, sub: o.blurb })),
    ],
  }));
  const loose = other.filter((o) => !groups.some((g) => g.group.key === o.group));
  if (loose.length) tiles.push({ key: "more", label: "More", tiles: loose.map((o): Tile => ({ key: o.key, href: o.href, icon: o.icon, title: o.title, sub: o.blurb })) });

  return (
    <main className="shell wide">
      <div className="o2 adm">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/" className="o2-back" aria-label="Back to home"><ChevronLeft size={22} /></Link>
            <div className="o2-title"><h1>Reports</h1></div>
          </div>
        </div>
        <ReportFinder groups={tiles} />
      </div>
    </main>
  );
}
