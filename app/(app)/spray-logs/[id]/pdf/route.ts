import { NextResponse } from "next/server";
import { getSession, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { logoUrl } from "@/lib/ops/server";
import { loadWorkOrder } from "@/lib/ops/work-orders-server";
import { renderWorkOrderPdf, workOrderFileName } from "@/lib/ops/work-order-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A contractor's shared spray log as a PDF, for AMBIT tech support. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !can(s.profile, "spray_log")) return new NextResponse("Not allowed", { status: 403 });
  const d = await loadWorkOrder(s.supabase, id);
  if (!d || !d.wo.share_ambit) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderWorkOrderPdf(d, { logo: logoUrl(d.company.logo) });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${workOrderFileName(d)}"`, "Cache-Control": "private, no-store" },
  });
}
