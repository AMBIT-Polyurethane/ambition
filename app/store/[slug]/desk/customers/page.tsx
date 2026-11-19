import { createClient } from "@/lib/supabase/server";
import { partnerMe } from "@/lib/partner-store";
import { DeskCustomers, type DeskCustomer, type DeskPriceItem } from "@/components/partner/desk-customers";

export const metadata = { title: "Customers" };

export default async function DeskCustomersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const me = await partnerMe(slug);
  const supabase = await createClient();
  const [cust, items] = await Promise.all([
    supabase.from("partner_customers").select("id, company, contact, email, phone, street, city, state, zip, terms, off_pct, notes, active, user_id, invited_at").eq("partner_id", slug).order("company").limit(2000),
    supabase.from("partner_items").select("id, sku, name, image_url, price, per_customer").eq("partner_id", slug).eq("active", true).order("sort").order("name").limit(5000),
  ]);
  const customers: DeskCustomer[] = ((cust.data ?? []) as (Omit<DeskCustomer, "has_login" | "off_pct"> & { user_id: string | null; off_pct: string })[]).map(({ user_id, ...c }) => ({
    ...c,
    off_pct: Number(c.off_pct),
    has_login: Boolean(user_id),
  }));
  const ids = customers.map((c) => c.id);
  const prices: Record<string, Record<string, number>> = {};
  if (ids.length) {
    const { data } = await supabase.from("partner_customer_prices").select("customer_id, item_id, price").in("customer_id", ids).limit(20000);
    for (const r of (data ?? []) as { customer_id: string; item_id: string; price: string }[]) (prices[r.customer_id] ??= {})[r.item_id] = Number(r.price);
  }
  const list: DeskPriceItem[] = ((items.data ?? []) as (Omit<DeskPriceItem, "price"> & { price: string | null })[]).map((i) => ({ ...i, price: i.price === null ? null : Number(i.price) }));
  return <DeskCustomers slug={slug} customers={customers} items={list} prices={prices} readOnly={me.kind !== "owner"} pick={sp.c && ids.includes(sp.c) ? sp.c : null} />;
}
