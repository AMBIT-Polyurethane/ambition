import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { inventoryBranches } from "@/lib/widgets";
import { every } from "@/lib/inventory/pages";
import { Empty, TopBar } from "@/components/ui";
import { HubNav, hubHome } from "@/components/inventory/hub-nav";
import { ValueEditor, type ValueRow } from "@/components/inventory/value-editor";

export const metadata = { title: "List values" };
export const dynamic = "force-dynamic";

/**
 * Admins: what each item is worth on the Inventory Hub dashboards and reports (an estimate of what it sells
 * for). Kept apart from the catalog price, so it never shows on the order screens or to customers.
 */
export default async function ListValuesPage() {
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin") redirect(hubHome(profile) ?? "/");
  const live = await inventoryBranches(supabase, profile);
  if (!live.length) return <main className="shell"><TopBar title="List values" back="/inventory" /><Empty icon="boxes" title="No inventory spreadsheet is connected yet" /></main>;
  const ids = live.map((b) => b.id);

  type Inv = { branch_id: string; product_id: string; on_hand: number | null; sell_price: number | null; product: { id: string; sku: string; name: string; unit: string; list_price: number | null; category_id: string | null } | null };
  const [inv, vals, { data: catRows }] = await Promise.all([
    every((a, z) =>
      supabase
        .from("inventory")
        .select("branch_id, product_id, on_hand, sell_price, product:products(id, sku, name, unit, list_price, category_id)")
        .in("branch_id", ids)
        .eq("on_sheet", true)
        .order("branch_id")
        .order("product_id")
        .range(a, z),
    ) as unknown as Promise<Inv[]>,
    every((a, z) => supabase.from("product_values").select("product_id, list_value").order("product_id").range(a, z)) as unknown as Promise<{ product_id: string; list_value: number }[]>,
    supabase.from("categories").select("id, name, sort").order("sort"),
  ]);
  const cats = new Map(((catRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const listValue = new Map(vals.map((v) => [v.product_id, Number(v.list_value)]));

  const byId = new Map<string, ValueRow>();
  for (const r of inv) {
    const p = r.product;
    if (!p) continue;
    const row =
      byId.get(p.id) ??
      ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        group: (p.category_id && cats.get(p.category_id)) || "Other",
        catalog: p.list_price !== null && Number(p.list_price) > 0 ? Number(p.list_price) : null,
        list: listValue.get(p.id) ?? null,
        onHand: 0,
        locations: 0,
        stockedAt: 0,
        sheet: [],
      } satisfies ValueRow);
    row.locations++;
    const q = Number(r.on_hand ?? 0);
    if (q > 0) {
      row.onHand += q;
      row.stockedAt++;
    }
    if (r.sell_price !== null && Number(r.sell_price) > 0) row.sheet.push(Number(r.sell_price));
    byId.set(p.id, row);
  }
  const groupOrder = [...new Set(((catRows ?? []) as { name: string }[]).map((c) => c.name)), "Other"];
  const rows = [...byId.values()].sort((a, z) => groupOrder.indexOf(a.group) - groupOrder.indexOf(z.group) || a.sku.localeCompare(z.sku, undefined, { numeric: true }));

  return (
    <main className="shell wide">
      <TopBar title="List values" back="/inventory" />
      <HubNav profile={profile} active="values" />
      <ValueEditor rows={rows} locationCount={live.length} />
    </main>
  );
}
