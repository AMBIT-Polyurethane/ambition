import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { packingSlipFileName, renderPackingSlip } from "@/lib/order-doc/packing-slip";
import { currentOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The packing slip (AMBIT staff only): the items, quantities and lots to load, the Sales Order # and Invoice #,
 * no prices, and the two signature boxes. Opens in the browser's PDF viewer, which has the Print button.
 * Nothing on it is filled in by hand: a different lot means changing the order and printing a new one.
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
  // A change an admin hasn't approved yet (0075): no packing slip until an admin approves it. Before 0075 nothing waits.
  const { count } = await supabase.from("order_edits").select("id", { count: "exact", head: true }).eq("order_id", id).eq("admin_needed", true).is("admin_approved_at", null);
  if (count) {
    const msg = "This order was changed and an admin hasn't approved the change yet, so its packing slip can't be printed. Once an admin approves it, print the packing slip again.";
    return NextResponse.redirect(new URL(`/orders/${id}?err=${encodeURIComponent(msg)}#change-approval`, await currentOrigin()));
  }
  const doc = await loadOrderDoc(supabase, id, { picks: true });
  if (!doc) return new NextResponse("Order not found", { status: 404 });
  const pdf = await renderPackingSlip(doc, { printedBy: me.full_name ?? me.email });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${packingSlipFileName(doc)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
