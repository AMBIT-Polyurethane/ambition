import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { packingSlipFileName, renderPackingSlip } from "@/lib/order-doc/packing-slip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The packing slip (AMBIT staff only): the items, quantities and lots to load, the Sales Order # and Invoice #,
 * no prices, and the two signature boxes. Opens in the browser's PDF viewer, which has the Print button.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(`/orders/${id}/packing-slip`)}`, req.url));
  const { data: me } = await supabase.from("profiles").select("role, full_name, email").eq("id", user.id).maybeSingle<{ role: string; full_name: string | null; email: string | null }>();
  if (me?.role !== "admin" && me?.role !== "employee") return new NextResponse("Packing slips are for AMBIT staff.", { status: 403 });
  const doc = await loadOrderDoc(supabase, id, { picks: true });
  if (!doc) return new NextResponse("Order not found", { status: 404 });
  // A change an admin hasn't approved yet (0075): the slip says DO NOT LOAD. Before 0075 nothing is waiting.
  const { count } = await supabase.from("order_edits").select("id", { count: "exact", head: true }).eq("order_id", id).eq("admin_needed", true).is("admin_approved_at", null);
  const pdf = await renderPackingSlip(doc, { printedBy: me.full_name ?? me.email, changeWaiting: Boolean(count) });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${packingSlipFileName(doc)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
