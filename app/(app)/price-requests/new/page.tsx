import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { packCustomer } from "@/lib/customers";
import { saleOn } from "@/lib/sale";
import { priceRules } from "@/lib/price-requests";
import { TopBar } from "@/components/ui";
import { PriceRequestForm, type PrProduct } from "@/components/price-request-form";

export const metadata = { title: "New price request" };
export const dynamic = "force-dynamic";

export default async function NewPriceRequestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!(can(profile, "price_requests") || profile.role === "admin")) redirect("/");
  const [{ data: companies }, { data: branches }, { data: prods }, { data: cats }, rules] = await Promise.all([
    supabase.from("companies").select("id, name, account_no, contact_name, city, state, default_branch_id, needs_qb_setup").eq("active", true).order("name"),
    supabase.from("branches").select("id, name").eq("active", true).order("sort"),
    supabase.from("products").select("id, sku, name, unit, list_price, sale_price, sale_ends, category_id, admin_only").eq("active", true).order("name"),
    supabase.from("categories").select("id, name").order("sort"),
    priceRules(supabase),
  ]);
  type P = { id: string; sku: string; name: string; unit: string; list_price: number | null; sale_price: number | null; sale_ends: string | null; category_id: string | null; admin_only?: boolean | null };
  const products: PrProduct[] = ((prods ?? []) as P[])
    .filter((p) => !p.admin_only)
    .map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit, cat: p.category_id, list: saleOn(p.sale_price, p.sale_ends) ? Number(p.sale_price) : p.list_price === null ? null : Number(p.list_price) }));
  return (
    <main className="shell">
      <TopBar title="New price request" back="/price-requests" />
      <p className="small muted" style={{ margin: 0 }}>
        Pick the customer and each product, and type the price you need.{" "}
        {rules.enabled ? "Prices that meet AMBIT's pricing rules are approved right away; the rest go to a manager." : "A manager approves them and you get an email."}
      </p>
      <PriceRequestForm
        companies={(companies ?? []).map((c) => packCustomer(c as Parameters<typeof packCustomer>[0]))}
        branches={(branches ?? []) as { id: string; name: string }[]}
        products={products}
        categories={(cats ?? []) as { id: string; name: string }[]}
        rules={rules.enabled ? { max_pct: rules.max_pct, cat_pct: rules.cat_pct, never: rules.never } : null}
        defaultBranch={profile.branch_id ?? ""}
        startCompany={sp.c ?? ""}
      />
    </main>
  );
}
