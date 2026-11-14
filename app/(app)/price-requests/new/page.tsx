import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { saleOn } from "@/lib/sale";
import { priceRules } from "@/lib/price-requests";
import { PRF_CATEGORIES } from "@/lib/prf";
import { TopBar } from "@/components/ui";
import { SmartPrf, type PrfCo, type PrfItem } from "@/components/prf/smart-prf";

export const metadata = { title: "New price request" };
export const dynamic = "force-dynamic";

/** The smart Price Request: existing or new customer, every detail, the product lines, then prices. */
export default async function NewPriceRequestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!(can(profile, "price_requests") || profile.role === "admin")) redirect("/");
  const [{ data: companies }, { data: prods }, rules] = await Promise.all([
    supabase.from("companies").select("id, name, contact_name, phone, email, bill_address, city, state, terms, credit_limit, credit_status, sales_rep_id").eq("active", true).order("name").range(0, 4999),
    supabase.from("products").select("id, sku, name, unit, list_price, sale_price, sale_ends, category_id, admin_only, sqft_per_unit, sort").eq("active", true).in("category_id", PRF_CATEGORIES).is("stock_of", null).order("sort").order("name"),
    priceRules(supabase),
  ]);
  type P = { id: string; sku: string; name: string; unit: string; list_price: number | null; sale_price: number | null; sale_ends: string | null; category_id: string | null; admin_only?: boolean | null; sqft_per_unit: number | null };
  const items: PrfItem[] = ((prods ?? []) as P[]).filter((p) => !p.admin_only).map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit, category_id: p.category_id,
    list: saleOn(p.sale_price, p.sale_ends) ? Number(p.sale_price) : p.list_price === null ? null : Number(p.list_price), sqft_per_unit: p.sqft_per_unit === null ? null : Number(p.sqft_per_unit) }));
  return (
    <main className="shell fx-shell">
      <TopBar title="New price request" back="/price-requests" />
      <SmartPrf companies={(companies ?? []) as PrfCo[]} items={items} branch={profile.branch_id ?? ""} startCompany={sp.c ?? sp.company}
        rules={rules.enabled ? { max_pct: rules.max_pct, cat_pct: rules.cat_pct, never: rules.never, max_lines: rules.max_lines } : null} />
    </main>
  );
}
