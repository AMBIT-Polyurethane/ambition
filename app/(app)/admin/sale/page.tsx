import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { SaleSheet, type SaleRow } from "@/components/sale-sheet";

export const metadata = { title: "Black Friday sale" };
export const dynamic = "force-dynamic";

type P = { id: string; sku: string; name: string; category_id: string | null; list_price: number | null; image_url: string | null; adc_image_url: string | null; customer_priced: boolean | null; active: boolean; admin_only: boolean | null; category: { name: string; customer_priced: boolean; admin_only: boolean | null } | null };

/** The sale sheet: every item on the ADC sale with our cost, today's price and markup, and the sale price to type in. */
export default async function SalePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: sales, error } = await supabase.from("web_sales").select("*").order("ends_on", { ascending: false });
  if (error) {
    return (
      <main className="shell">
        <div className="alert warn">The sale sheet needs database update 0091. Run it in Supabase, then reload this page.</div>
      </main>
    );
  }
  const list = (sales ?? []) as { id: number; slug: string; name: string; starts_on: string; ends_on: string; foam_off_per_lb: number | null }[];
  const sale = list.find((s) => s.slug === sp.s) ?? list[0];
  if (!sale) return <main className="shell"><div className="alert warn">No sale set up yet.</div></main>;
  const [{ data: items }, { data: prods }, { data: costs }] = await Promise.all([
    supabase.from("web_sale_items").select("product_id, price").eq("sale_id", sale.id).limit(5000),
    supabase.from("products").select("id, sku, name, category_id, list_price, image_url, adc_image_url, customer_priced, active, admin_only, category:categories(name, customer_priced, admin_only)").eq("active", true).order("sku").limit(5000),
    supabase.from("product_costs").select("product_id, cost").limit(5000),
  ]);
  const cost = new Map(((costs ?? []) as { product_id: string; cost: number }[]).map((c) => [c.product_id, Number(c.cost)]));
  const onSale = new Map(((items ?? []) as { product_id: string; price: number | null }[]).map((i) => [i.product_id, i.price === null ? null : Number(i.price)]));
  const all = ((prods ?? []) as unknown as P[]).filter((p) => !p.admin_only && !p.category?.admin_only);
  const row = (p: P): SaleRow => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category?.name ?? "",
    image: p.adc_image_url ?? p.image_url,
    cost: cost.get(p.id) ?? null,
    price: p.list_price === null ? null : Number(p.list_price),
    // Spray foam is discounted $/lb off each customer's price instead (the foam setting above the sheet).
    foam: p.category_id === "ambit-foam",
    perCustomer: p.list_price === null || Boolean(p.customer_priced ?? p.category?.customer_priced),
    sale: onSale.get(p.id) ?? null,
  });
  const rows = all.filter((p) => onSale.has(p.id)).map(row);
  const others = all.filter((p) => !onSale.has(p.id)).map(row);

  return (
    <main className="shell wide">
      <div className="o2 sale">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/admin" className="o2-back" aria-label="Back to admin"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>{sale.name} sale</h1>
              <span className="o2-sub">On the ADC web store · {rows.length} items on the sheet · {rows.filter((r) => r.sale !== null).length} with a sale price</span>
            </div>
          </div>
          <div className="o2-head-r">
            <a href="/adc?sale=1" target="_blank" rel="noopener noreferrer" className="b2 quiet sm"><ExternalLink size={16} /> See it on the store</a>
          </div>
        </div>
        <SaleSheet sale={{ id: sale.id, name: sale.name, starts_on: sale.starts_on, ends_on: sale.ends_on, foam_off_per_lb: sale.foam_off_per_lb === null ? null : Number(sale.foam_off_per_lb) }} rows={rows} others={others} costCount={cost.size} />
      </div>
    </main>
  );
}
