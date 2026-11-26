import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/access";
import { inventorySheets } from "@/lib/inventory/view";
import { GROUPS, groupOf } from "@/lib/inventory/lots";
import { todayCentral } from "@/lib/sale";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Foam lots > Download: every lot at a location with the same columns as the Foam lots screen (a snapshot). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.profile || !(can(s.profile, "inventory") || can(s.profile, "item_variance") || s.profile.role === "admin")) return new NextResponse("Not allowed", { status: 403 });
  const b = req.nextUrl.searchParams.get("b") ?? "";
  const sheets = await inventorySheets(s.supabase);
  if (!/^[a-z0-9_-]{1,24}$/i.test(b) || !sheets.some((x) => x.branch_id === b && x.enabled)) return new NextResponse("Pick a location", { status: 400 });
  const today = todayCentral();
  const [{ data: lotRows }, { data: lineRows }, { data: holdRows }] = await Promise.all([
    s.supabase
      .from("inventory_lots")
      .select("id, product_id, sku, lot_no, mfg, exp, use_by, starting, shipped_out, shipped_in, adj, out_unsynced, remaining, in_unsynced, adj_unsynced, sheet_pending, sort, products(name)")
      .eq("branch_id", b)
      .or("on_sheet.eq.true,add_to_sheet.eq.true")
      .range(0, 4999),
    s.supabase.from("inventory_lines").select("lot_id, qty").eq("branch_id", b).eq("state", "reserved").not("lot_id", "is", null).range(0, 9999),
    s.supabase.from("inventory_holds").select("lot_id, qty").eq("branch_id", b).is("released_at", null).gte("until", today),
  ]);
  type L = {
    id: number; product_id: string; sku: string; lot_no: string | null; mfg: string | null; exp: string | null; use_by: string | null;
    starting: number; shipped_out: number; shipped_in: number; adj: number; out_unsynced: number; remaining: number; in_unsynced: number; adj_unsynced: number;
    sheet_pending: number; sort: number; products: { name: string } | null;
  };
  const promised = new Map<number, number>();
  for (const l of (lineRows ?? []) as { lot_id: number; qty: number }[]) promised.set(l.lot_id, (promised.get(l.lot_id) ?? 0) + Number(l.qty));
  const held = new Map<number, number>();
  for (const h of (holdRows ?? []) as { lot_id: number; qty: number }[]) held.set(h.lot_id, (held.get(h.lot_id) ?? 0) + Number(h.qty));
  const rows = (lotRows ?? []) as unknown as L[];
  const first = new Map<string, number>();
  for (const l of rows) first.set(l.product_id, Math.min(first.get(l.product_id) ?? Infinity, l.sort));
  const gi = (sku: string) => GROUPS.indexOf(groupOf(sku));
  rows.sort((a, z) => gi(a.sku) - gi(z.sku) || first.get(a.product_id)! - first.get(z.product_id)! || a.product_id.localeCompare(z.product_id) || a.sort - z.sort || a.id - z.id);
  const csv = toCsv(
    ["Group", "SKU", "Product", "Lot #", "Mfg date", "Exp date", "Use by", "Starting", "Shipped out", "Shipped in", "Adj", "Remaining", "On open orders", "Held", "Free"],
    rows.map((l) => {
      const left = r2(Number(l.remaining) + Number(l.in_unsynced) + Number(l.adj_unsynced));
      const p = r2(Number(l.sheet_pending) + (promised.get(l.id) ?? 0));
      const h = r2(held.get(l.id) ?? 0);
      return [
        groupOf(l.sku).band.replace(/\s{2,}/g, " "),
        l.sku,
        l.products?.name ?? l.sku,
        l.lot_no ?? "",
        l.mfg ?? "",
        l.exp ?? "",
        l.use_by ?? "",
        r2(Number(l.starting)),
        r2(Number(l.shipped_out) + Number(l.out_unsynced)),
        r2(Number(l.shipped_in) + Number(l.in_unsynced)),
        r2(Number(l.adj) + Number(l.adj_unsynced)),
        left,
        p,
        h,
        Math.max(0, r2(left - p - h)),
      ];
    }),
  );
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="AMBIT foam lots - ${b.toUpperCase()} - ${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
