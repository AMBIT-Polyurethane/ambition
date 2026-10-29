import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { proposalOf } from "@/lib/ops/proposal";
import { logoUrl } from "@/lib/ops/server";
import { proposalFileName, renderProposalPdf } from "@/lib/ops/proposal-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The proposal PDF for whoever holds the private link. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("ops_proposal", { p_token: token, p_count: false });
  const p = proposalOf(data);
  if (!p) return new NextResponse("This link isn't valid.", { status: 404 });
  const pdf = await renderProposalPdf(p, { logo: logoUrl(p.company.logo_path), link: new URL(`/p/${token}`, req.url).toString() });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${proposalFileName(p)}"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
