import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/session";
import { hubAllows } from "@/lib/access";
import { TopBar } from "@/components/ui";
import { HubNav } from "@/components/inventory/hub-nav";
import { inventorySheets } from "@/lib/inventory/view";
import { canSetRop } from "@/lib/inventory/reorder";
import { AddStockItem, type AddProduct } from "@/components/inventory/add-stock-item";

export const metadata = { title: "Add an item" };
export const dynamic = "force-dynamic";

/** Stock > Add an item (0116): put a product on a location's list. The app adds its row to the COUNT SHEET. */
export default async function AddItemPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requirePerm("inventory");
  const [sheets, { data: branchRows }, { data: catRows }] = await Promise.all([
    inventorySheets(supabase),
    supabase.from("branches").select("id, name, state").order("sort"),
    supabase.from("categories").select("id, name, sort").order("sort"),
  ]);
  const live = sheets.filter((s) => s.enabled);
  const branch = (live.find((s) => s.branch_id === sp.b) ?? live.find((s) => s.branch_id === profile.branch_id) ?? live[0])?.branch_id;
  if (!branch) redirect("/inventory/stock");
  if (!hubAllows(profile, branch) || !canSetRop(profile, branch)) redirect(`/inventory/stock?b=${branch}`);
  const b = ((branchRows ?? []) as { id: string; name: string; state: string }[]).find((x) => x.id === branch);
  const where = b ? `${b.name}, ${b.state}` : branch.toUpperCase();

  const cols = "id, sku, name, unit, active, stock_of, category_id";
  const first = await supabase.from("products").select(`${cols}, vendor_name, vendor_lead_days`).order("sku").range(0, 4999);
  const prods = first.error ? await supabase.from("products").select(cols).order("sku").range(0, 4999) : first;
  const [{ data: inv }, { data: lotted }] = await Promise.all([
    supabase.from("inventory").select("product_id, on_sheet").eq("branch_id", branch).range(0, 4999),
    supabase.from("inventory_lots").select("product_id").range(0, 9999),
  ]);
  // Already on this location's list: on the COUNT SHEET, or just added (0116). Before 0116 only on_sheet counts.
  const addRes = await supabase.from("inventory").select("product_id").eq("branch_id", branch).eq("add_to_sheet", true).range(0, 4999);
  const have = new Set([
    ...((inv ?? []) as { product_id: string; on_sheet: boolean }[]).filter((r) => r.on_sheet).map((r) => r.product_id),
    ...((addRes.error ? [] : addRes.data ?? []) as { product_id: string }[]).map((r) => r.product_id),
  ]);
  const byLot = new Set(((lotted ?? []) as { product_id: string }[]).map((r) => r.product_id));
  const catName = new Map(((catRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  type P = { id: string; sku: string; name: string; unit: string | null; active: boolean; stock_of: string | null; category_id: string | null; vendor_name?: string | null; vendor_lead_days?: number | null };
  const products: AddProduct[] = ((prods.data ?? []) as unknown as P[])
    .filter((p) => (p.active || p.stock_of) && !have.has(p.id))
    .map((p) => ({
      id: p.id, sku: p.sku, name: p.name, unit: p.unit ?? "each", category: p.category_id ? catName.get(p.category_id) ?? null : null,
      vendor: p.vendor_name ?? null, lead: p.vendor_lead_days ?? null, byLot: byLot.has(p.id),
    }));

  return (
    <main className="shell wide">
      <TopBar title="Add an item" back={`/inventory/stock?b=${branch}`} />
      <HubNav profile={profile} active="stock" branch={branch} />
      <p className="small muted" style={{ margin: 0 }}>
        Put a product on {where}&apos;s stock list. It shows up on the stock list and the order screen right away. <Link href={`/inventory/stock?b=${branch}`}>Back to Stock</Link>
      </p>
      <AddStockItem branch={branch} where={where} products={products} />
    </main>
  );
}
