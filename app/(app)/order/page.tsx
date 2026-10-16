import { requireActive, isEmployee } from "@/lib/session";
import { OrderBuilder, type CatalogProduct } from "@/components/order-builder";
import type { Branch, Category, Company, Product } from "@/lib/types";

export const metadata = { title: "Order" };

export default async function OrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);

  const [{ data: products }, { data: categories }, { data: branches }, companiesRes, reorderRes] = await Promise.all([
    supabase.from("products").select("*").eq("active", true).order("sort").order("name"),
    supabase.from("categories").select("*").order("sort"),
    supabase.from("branches").select("*").eq("active", true).order("sort"),
    emp
      ? supabase.from("companies").select("id, name, account_no, default_branch_id").eq("active", true).order("name")
      : Promise.resolve({ data: null }),
    sp.reorder
      ? supabase.from("orders").select("order_no, company_id, order_items(product_id, qty)").eq("id", sp.reorder).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cats = (categories ?? []) as Category[];
  const cpByCat = new Map(cats.map((c) => [c.id, c.customer_priced]));
  const catalog: CatalogProduct[] = ((products ?? []) as Product[]).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category_id: p.category_id,
    unit: p.unit,
    list_price: p.list_price === null ? null : Number(p.list_price),
    cp: p.customer_priced ?? (p.category_id ? cpByCat.get(p.category_id) ?? false : false),
  }));

  const reorderData = reorderRes.data as { order_no: number; company_id: string | null; order_items: { product_id: string | null; qty: number }[] } | null;
  const reorder = reorderData
    ? Object.fromEntries(reorderData.order_items.filter((i) => i.product_id).map((i) => [i.product_id as string, Number(i.qty)]))
    : null;

  return (
    <OrderBuilder
      products={catalog}
      categories={cats.filter((c) => catalog.some((p) => p.category_id === c.id))}
      branches={(branches ?? []) as Branch[]}
      companies={(companiesRes.data ?? null) as Company[] | null}
      isEmployee={emp}
      me={{
        name: profile.full_name ?? profile.email,
        email: profile.email,
        company: profile.company ? { name: profile.company.name, account_no: profile.company.account_no } : null,
        defaultBranch: profile.company?.default_branch_id ?? profile.branch_id ?? null,
      }}
      reorder={reorder}
      reorderNo={reorderData?.order_no ?? null}
      reorderCompany={reorderData?.company_id ?? null}
    />
  );
}
