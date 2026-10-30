import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { pdfFileName, renderOrderPdf } from "@/lib/order-doc/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The printable order for anyone who can see the order in the app. AMBIT staff get the warehouse copy
 * (brand and lot for spray foam, COD Only / No Checks Allowed) unless they ask for ?copy=customer; contractors get
 * the customer's copy ("not an order or a quotation"). Nobody else can read lots at all.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(`/orders/${id}/pdf`)}`, req.url));

  // AMBIT staff get the warehouse copy unless they ask for the customer's; contractors always get their copy.
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  const staff = (me?.role === "admin" || me?.role === "employee") && new URL(req.url).searchParams.get("copy") !== "customer";
  const doc = await loadOrderDoc(supabase, id, { picks: staff });
  if (!doc) return new NextResponse("Order not found", { status: 404 });
  const pdf = await renderOrderPdf(doc, { audience: staff ? "staff" : "customer" });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFileName(doc)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
