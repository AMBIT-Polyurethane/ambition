import { redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { OrderBuilder, type CatalogProduct } from "@/components/order-builder";
import { approvalsEnabled } from "@/lib/order-send";
import type { OrderCustomer } from "@/lib/customers";
import type { Branch, Category, Company, Product } from "@/lib/types";

export const metadata = { title: "Order" };

export default async function OrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  if (emp && !can(profile, "ordering")) redirect("/");

  const [{ data: products }, { data: categories }, { data: branches }, companiesRes, myCompanyRes, reorderRes] = await Promise.all([
    supabase.from("products").select("*").eq("active", true).order("sort").order("name"),
    supabase.from("categories").select("*").order("sort"),
    supabase.from("branches").select("*").eq("active", true).order("sort"),
    // Staff pick from every customer. Contractors never receive the list (the database won't send it either).
    emp ? supabase.from("companies").select("*").eq("active", true).order("name") : Promise.resolve({ data: null }),
    !emp && profile.company_id
      ? supabase.from("companies").select("*").eq("id", profile.company_id).maybeSingle()
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
    image_url: p.image_url,
    list_price: p.list_price === null ? null : Number(p.list_price),
    cp: p.customer_priced ?? (p.category_id ? cpByCat.get(p.category_id) ?? false : false),
    sqft: p.sqft_per_unit != null && Number(p.sqft_per_unit) > 0 ? Number(p.sqft_per_unit) : null,
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
      companies={emp ? ((companiesRes.data ?? []) as Company[]).map(toOrderCustomer) : null}
      isEmployee={emp}
      approvals={emp && approvalsEnabled()}
      me={{
        name: profile.full_name ?? profile.email,
        email: profile.email,
        company: profile.company
          ? {
              name: profile.company.name,
              account_no: profile.company.account_no,
              ship_address: (myCompanyRes.data as Company | null)?.ship_address ?? null,
              bill_address: (myCompanyRes.data as Company | null)?.bill_address ?? null,
            }
          : null,
        defaultBranch: profile.company?.default_branch_id ?? profile.branch_id ?? null,
      }}
      reorder={reorder}
      reorderNo={reorderData?.order_no ?? null}
      reorderCompany={reorderData?.company_id ?? null}
    />
  );
}

function toOrderCustomer(c: Company): OrderCustomer {
  return {
    id: c.id,
    name: c.name,
    account_no: c.account_no,
    default_branch_id: c.default_branch_id,
    contact_name: c.contact_name ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    bill_address: c.bill_address ?? null,
    ship_address: c.ship_address ?? null,
    needs_qb_setup: c.needs_qb_setup ?? false,
  };
}
