import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { pdfFileName, renderOrderPdf } from "@/lib/order-doc/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The printable order for anyone who can see the order in the app. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(`/orders/${id}/pdf`)}`, req.url));

  const doc = await loadOrderDoc(supabase, id);
  if (!doc) return new NextResponse("Order not found", { status: 404 });
  const pdf = await renderOrderPdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFileName(doc)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
