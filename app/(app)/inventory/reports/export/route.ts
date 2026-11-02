import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { can, hubLock } from "@/lib/access";
import { loadHub } from "@/lib/inventory/hub";
import { REPORTS, buildReport, reportCsv, type ReportKey } from "@/lib/inventory/reports";
import { todayCentral } from "@/lib/sale";

export const dynamic = "force-dynamic";

/** A report as a CSV file (opens in Excel). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "inv_reports")) return new NextResponse("Not allowed", { status: 403 });
  const key = (REPORTS.find((r) => r.key === req.nextUrl.searchParams.get("r"))?.key ?? "reorder") as ReportKey;
  const lock = hubLock(s.profile);
  if (lock === "") return new NextResponse("Your account isn't set to a location yet.", { status: 403 });
  const b = lock ?? req.nextUrl.searchParams.get("b") ?? "all";
  const hub = await loadHub(s.supabase, b === "all" ? "all" : [b]);
  const csv = reportCsv(buildReport(hub, key));
  const where = b === "all" ? "all-locations" : b;
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="inventory-${key}-${where}-${todayCentral()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
