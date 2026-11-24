import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canEstimate } from "@/lib/access";
import { loadEstimate } from "@/lib/estimates";
import { estimateFileName, renderEstimatePdf } from "@/lib/estimate-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The customer's copy of the estimate, as it would be emailed. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s?.profile || !canEstimate(s.profile)) return new NextResponse("Not allowed", { status: 403 });
  const d = await loadEstimate(s.supabase, id);
  if (!d) return new NextResponse("Not found", { status: 404 });
  const { data: b } = d.est.branch_id ? await s.supabase.from("branches").select("name").eq("id", d.est.branch_id).maybeSingle<{ name: string }>() : { data: null };
  const pdf = await renderEstimatePdf(d.est, d.items, b?.name ?? null);
  const download = new URL(req.url).searchParams.has("download");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${estimateFileName(d.est)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
