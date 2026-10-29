import { NextResponse } from "next/server";
import { getWorkspace, logoUrl } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { proposalForQuote } from "@/lib/ops/proposal-server";
import { proposalFileName, renderProposalPdf } from "@/lib/ops/proposal-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The contractor's own copy of a proposal (drafts too). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getWorkspace();
  if (!s || !opsCan.crm(s.ws.role)) return new NextResponse("Not allowed", { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const r = await proposalForQuote(s.supabase, s.ws, id);
  if (!r) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderProposalPdf(r.p, { logo: logoUrl(r.p.company.logo_path), link: r.token ? new URL(`/p/${r.token}`, req.url).toString() : null });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${proposalFileName(r.p)}"`, "Cache-Control": "private, no-store" },
  });
}
