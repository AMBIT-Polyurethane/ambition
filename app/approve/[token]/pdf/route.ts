import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { docFromJson } from "@/lib/order-doc/load";
import { pdfFileName, renderOrderPdf } from "@/lib/order-doc/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The printable order for whoever holds the approval link. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("order_approval_view", { p_token: token });
  const doc = docFromJson(data);
  if (!doc) return new NextResponse("This link isn't valid.", { status: 404 });
  const approveUrl = new URL(`/approve/${token}`, req.url).toString();
  const pdf = await renderOrderPdf(doc, { approveUrl });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFileName(doc)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
