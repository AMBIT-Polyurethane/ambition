import { NextResponse } from "next/server";
import { getWorkspace, logoUrl } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { loadWorkOrder } from "@/lib/ops/work-orders-server";
import { renderWorkOrderPdf, workOrderFileName } from "@/lib/ops/work-order-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The contractor's copy of a work order's spray log (SDL-01 layout). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getWorkspace();
  if (!s || !opsCan.jobs(s.ws.role)) return new NextResponse("Not allowed", { status: 403 });
  const d = await loadWorkOrder(s.supabase, id);
  if (!d || !d.mine) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderWorkOrderPdf(d, { logo: logoUrl(d.company.logo) });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${workOrderFileName(d)}"`, "Cache-Control": "private, no-store" },
  });
}
