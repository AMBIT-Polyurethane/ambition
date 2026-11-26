import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/access";
import { branchStock, inventorySheets } from "@/lib/inventory/view";
import { todayCentral } from "@/lib/sale";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Stock > Download stock list: a location's stock as a spreadsheet (a snapshot; A.I. stays the record). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "inventory")) return new NextResponse("Not allowed", { status: 403 });
  const b = req.nextUrl.searchParams.get("b") ?? "";
  const sheets = await inventorySheets(s.supabase);
  if (!/^[a-z0-9_-]{1,24}$/i.test(b) || !sheets.some((x) => x.branch_id === b && x.enabled)) return new NextResponse("Pick a location", { status: 400 });
  const [rows, { data: cats }] = await Promise.all([branchStock(s.supabase, b), s.supabase.from("categories").select("id, name")]);
  const cat = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const csv = toCsv(
    ["SKU", "Item", "Category", "Unit", "In stock", "On open orders", "Available", "Reorder at", "Max", "Vendor", "Lead days", "Last counted", "Counted by", "Lots"],
    rows.map((r) => [
      r.sku,
      r.name,
      r.category_id ? cat.get(r.category_id) ?? "" : "",
      r.unit,
      r.on_hand,
      r.pending || 0,
      r.net,
      r.reorder_point,
      r.max_qty,
      r.vendor ?? "",
      r.lead_days ?? null,
      r.last_counted ?? "",
      r.counted_by ?? "",
      r.lots?.length ? r.lots.map((l) => `${l.lot_no} (${l.remaining})`).join("; ") : "",
    ]),
  );
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="AMBIT stock - ${b.toUpperCase()} - ${todayCentral()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
