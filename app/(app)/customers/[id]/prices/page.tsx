import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Sheet } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit } from "@/lib/credit";
import { allRows, canPrice, type CustPrice, type PriceItem } from "@/lib/prices";
import { TopBar } from "@/components/ui";
import { CustomerPrices } from "@/components/prices/customer-prices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer prices" };

/** What this customer pays for every item. Price approvers and admins change them; the order desk and Accounting can look. */
export default async function CustomerPricesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireEmployee();
  const editable = canPrice(profile);
  if (!editable && !canCredit(profile)) redirect("/");
  const [{ data: co }, items, { data: cats }, { data: prices }] = await Promise.all([
    supabase.from("companies").select("id, name, account_no").eq("id", id).maybeSingle(),
    allRows<PriceItem>((f, t) => {
      let q = supabase.from("products").select("id, sku, name, unit, category_id, list_price, sqft_per_unit").eq("active", true).is("stock_of", null);
      if (profile.role !== "admin") q = q.eq("admin_only", false);
      return q.order("category_id").order("sort").order("name").range(f, t);
    }),
    supabase.from("categories").select("id, name, sort").order("sort"),
    supabase.from("customer_prices").select("*").eq("company_id", id),
  ]);
  if (!co) notFound();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return (
    <main className="shell wide">
      <TopBar title={`${co.name} · prices`} back={`/customers/${id}?tab=prices`} right={editable ? <Link href={`/prices?q=${encodeURIComponent(co.name)}`} className="btn sm dark"><Sheet size={15} /> Master price sheet</Link> : null} />
      <p className="small muted" style={{ margin: 0 }}>
        Type what {co.name} pays. Foam is priced <b>per lb</b> and fiberglass <b>per sq ft</b> (we work out the drum or bag price for you). Leave it blank for no special price.
        {editable ? null : " Only admins and price approvers can change these."}
      </p>
      <CustomerPrices company={id} items={items} cats={((cats ?? []) as { id: string; name: string }[])} prices={(prices ?? []) as CustPrice[]} editable={editable} today={today} />
    </main>
  );
}
