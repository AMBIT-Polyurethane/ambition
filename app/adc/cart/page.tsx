import type { Metadata } from "next";
import { adcCatalog } from "@/lib/adc";
import { createClient } from "@/lib/supabase/server";
import { AdcCheckout, type CatInfo } from "@/components/adc/checkout";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function AdcCartPage() {
  const { items, sale } = await adcCatalog();
  const supabase = await createClient();
  const { data: branches } = await supabase.from("branches").select("id, name").eq("active", true).order("sort");
  const cat: Record<string, CatInfo> = {};
  for (const i of items) cat[i.id] = { sku: i.sku, name: i.name, unit: i.unit, list_price: i.list_price, sale_price: i.sale_price, quote: i.quote, image: i.image };
  return (
    <div className="adc-wrap adc-pad adc-stack">
      <h1 className="adc-h1">Your cart</h1>
      <AdcCheckout cat={cat} branches={(branches ?? []) as { id: string; name: string }[]} foamNote={sale?.foam_off_per_lb ? `${sale.name}: $${Number(sale.foam_off_per_lb).toFixed(2)} per lb off your price` : null} />
    </div>
  );
}
