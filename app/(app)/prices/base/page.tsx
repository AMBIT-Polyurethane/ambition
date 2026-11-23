import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { allRows, basisFor, canPrice, type Basis, type CustPrice, type PendingChange, type PriceItem } from "@/lib/prices";
import { TopBar } from "@/components/ui";
import { CustomerPrices } from "@/components/prices/customer-prices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Base prices" };

/** The base price list (0106): what every customer pays who has no price of their own on an item. */
export default async function BasePricesPage() {
  const { supabase, profile } = await requireEmployee();
  if (!canPrice(profile)) redirect("/customers");
  await supabase.rpc("price_apply_due");
  const [items, { data: cats }, baseRows, pendRes] = await Promise.all([
    allRows<PriceItem>((f, t) => {
      let q = supabase.from("products").select("*").eq("active", true).is("stock_of", null);
      if (profile.role !== "admin") q = q.eq("admin_only", false);
      return q.order("category_id").order("sort").order("name").range(f, t);
    }),
    supabase.from("categories").select("id, name, sort").order("sort"),
    allRows<{ product_id: string; price: number; basis: Basis; updated_by_name: string | null; updated_at: string }>((f, t) => supabase.from("base_prices").select("*").range(f, t)),
    supabase.from("price_changes").select("batch_id, company_id, product_id, new_price, basis, effective_on").is("company_id", null).is("applied_at", null).is("cancelled_at", null).order("effective_on"),
  ]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const byId = new Map(baseRows.map((b) => [b.product_id, b]));
  // Foam and batts: their base price per lb / sq ft. Everything else: the list price.
  const prices: CustPrice[] = items.flatMap((p): CustPrice[] => {
    const b = byId.get(p.id);
    if (b) return [{ company_id: "base", product_id: p.id, price: Number(b.price), basis: b.basis, effective_on: today, expires_on: null, source: "manual", source_ref: null, note: null, updated_by_name: b.updated_by_name, updated_at: b.updated_at }];
    if (basisFor(p) === "unit" && p.list_price !== null) return [{ company_id: "base", product_id: p.id, price: Number(p.list_price), basis: "unit" as Basis, effective_on: today, expires_on: null, source: "manual", source_ref: "List price", note: null, updated_by_name: null, updated_at: today }];
    return [];
  });
  return (
    <main className="shell wide">
      <TopBar title="Base prices" back="/prices/dashboard" right={<Link href="/prices/dashboard" className="btn sm dark"><LayoutDashboard size={15} /> Pricing dashboard</Link>} />
      <p className="small muted" style={{ margin: 0 }}>
        What every customer pays who has no price of their own on an item. Spray foam is per <b>lb</b> and fiberglass batts per <b>sq ft</b>; everything else is its list price each (the price ADC shows for items that aren&apos;t MSRP-priced).
        A customer&apos;s own price always wins. To raise many at once, use the pricing dashboard.
      </p>
      {pendRes.error ? <div className="alert warn small">Base prices need the 0106 database update first (Supabase &gt; SQL Editor).</div> : null}
      <CustomerPrices mode="base" company="base" items={items} cats={(cats ?? []) as { id: string; name: string }[]} prices={prices} editable today={today} pending={(pendRes.data ?? []) as PendingChange[]} />
    </main>
  );
}
