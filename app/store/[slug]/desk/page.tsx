import { createClient } from "@/lib/supabase/server";
import { partnerMe } from "@/lib/partner-store";
import { DeskPrices, type DeskItem } from "@/components/partner/desk-prices";

type Row = Omit<DeskItem, "ambit" | "cost" | "price" | "qty_on_hand"> & { product_id: string | null; cost: string | null; price: string | null; qty_on_hand: string | null };
const n = (v: string | null) => (v === null ? null : Number(v));

export default async function DeskPriceSheet({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const me = await partnerMe(slug);
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_items")
    .select("id, product_id, sku, name, description, category, unit, image_url, cost, price, per_customer, qty_on_hand, active, sort")
    .eq("partner_id", slug)
    .order("sort")
    .order("name")
    .limit(5000);
  const items: DeskItem[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id, sku: r.sku, name: r.name, description: r.description, category: r.category, unit: r.unit, image_url: r.image_url,
    cost: n(r.cost), price: n(r.price), per_customer: r.per_customer, qty_on_hand: n(r.qty_on_hand), active: r.active, ambit: Boolean(r.product_id),
  }));
  return (
    <>
      {sp.welcome && me.kind === "owner" ? (
        <div className="ptn-ok" style={{ marginBottom: 18 }}>
          <span><b>Welcome to your store desk{me.name ? `, ${me.name.split(/\s+/)[0]}` : ""}.</b> Start here: type your purchase price and sell price for each item. Then add your customers and send them their logins.</span>
        </div>
      ) : null}
      <DeskPrices slug={slug} items={items} readOnly={me.kind !== "owner"} />
    </>
  );
}
