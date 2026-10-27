import { redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { OrderBuilder, type CatalogProduct, type OrderDraft, type StockMap } from "@/components/order-builder";
import { approvalsEnabled } from "@/lib/order-send";
import { saleOn, todayCentral } from "@/lib/sale";
import { packCustomer } from "@/lib/customers";
import { smartDraft } from "@/lib/reorder";
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
    // Only what the search needs (the chosen customer's address and email are fetched when they're picked).
    emp
      ? supabase.from("companies").select("id, name, account_no, contact_name, city, state, default_branch_id, needs_qb_setup").eq("active", true).order("name")
      : Promise.resolve({ data: null }),
    !emp && profile.company_id
      ? supabase.from("companies").select("*").eq("id", profile.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sp.reorder
      ? supabase.from("orders").select("order_no, company_id, order_items(product_id, qty)").eq("id", sp.reorder).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Live stock for locations with an inventory spreadsheet (Oklahoma City first). Staff see the numbers;
  // contractors only In stock / Low stock / Ships from supplier (the database decides what each gets).
  const stockBranches = emp
    ? (((await supabase.from("inventory_sheets").select("branch_id").eq("enabled", true)).data ?? []) as { branch_id: string }[]).map((b) => b.branch_id)
    : [profile.company?.default_branch_id ?? profile.branch_id].filter((b): b is string => Boolean(b));
  const stock: StockMap = {};
  await Promise.all(
    stockBranches.map(async (b) => {
      const { data, error } = await supabase.rpc("stock_for", { p_branch: b });
      if (error || !data?.length) return;
      stock[b] = Object.fromEntries(
        (data as { product_id: string; on_hand: number | null; pending: number | null; net: number | null; reorder_point: number | null; label: string | null }[]).map((r) => [
          r.product_id,
          {
            on_hand: r.on_hand === null ? null : Number(r.on_hand),
            pending: r.pending === null ? null : Number(r.pending),
            net: r.net === null ? null : Number(r.net),
            label: r.label === "in" || r.label === "low" || r.label === "out" ? r.label : null,
          },
        ]),
      );
    }),
  );

  const cats = (categories ?? []) as Category[];
  const cpByCat = new Map(cats.map((c) => [c.id, c.customer_priced]));
  const today = todayCentral();
  const catalog: CatalogProduct[] = ((products ?? []) as Product[]).map((p) => {
    const list = p.list_price === null ? null : Number(p.list_price);
    // A sale price wins over the list price and over "Based on customer pricing" (the database charges it the same way).
    const sale = saleOn(p.sale_price, p.sale_ends, today);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      category_id: p.category_id,
      unit: p.unit,
      image_url: p.image_url,
      list_price: sale ? Number(p.sale_price) : list,
      was: sale && list !== null && list > Number(p.sale_price) ? list : null,
      sale,
      cp: !sale && (p.customer_priced ?? (p.category_id ? cpByCat.get(p.category_id) ?? false : false)),
      sqft: p.sqft_per_unit != null && Number(p.sqft_per_unit) > 0 ? Number(p.sqft_per_unit) : null,
    };
  });

  // A brand that's only stocked, never sold by name (ISO-COVESTRO), reorders as what the store sells (ISO A-Side).
  const { data: parentRows } = await supabase.rpc("stock_parents");
  const parentOf = new Map(((parentRows ?? []) as { product_id: string; parent_id: string }[]).map((r) => [r.product_id, r.parent_id]));
  const sold = (pid: string) => parentOf.get(pid) ?? pid;

  const reorderData = reorderRes.data as { order_no: number; company_id: string | null; order_items: { product_id: string | null; qty: number }[] } | null;
  let reorder: Record<string, number> | null = null;
  if (reorderData) {
    reorder = {};
    for (const i of reorderData.order_items) if (i.product_id) reorder[sold(i.product_id)] = (reorder[sold(i.product_id)] ?? 0) + Number(i.qty);
  }

  // A draft from AI order intake (staff), or this customer's usual items (smart reorder).
  let draft: OrderDraft | null = null;
  if (emp && sp.draft && /^[0-9a-f-]{36}$/i.test(sp.draft)) {
    const { data: d } = await supabase.from("order_drafts").select("*").eq("id", sp.draft).maybeSingle();
    if (d && d.status !== "sent") {
      const items: Record<string, number> = {};
      for (const it of (d.items ?? []) as { product_id: string | null; qty: number }[]) {
        if (it.product_id && Number(it.qty) > 0) items[sold(it.product_id)] = (items[sold(it.product_id)] ?? 0) + Number(it.qty);
      }
      draft = {
        id: d.id,
        source: "intake",
        companyId: d.company_id,
        branchId: d.branch_id,
        delivery: d.delivery_method,
        address: d.ship_address,
        po: d.po_number,
        neededBy: d.needed_by,
        notes: d.notes,
        items,
      };
    }
  } else if (sp.smart) {
    const company = emp ? (sp.company && /^[0-9a-f-]{36}$/i.test(sp.company) ? sp.company : null) : profile.company_id;
    if (company) draft = await smartDraft(supabase, company, sp.smart === "all", emp);
  }

  return (
    <OrderBuilder
      products={catalog}
      categories={cats.filter((c) => catalog.some((p) => p.category_id === c.id))}
      branches={(branches ?? []) as Branch[]}
      companies={emp ? ((companiesRes.data ?? []) as Company[]).map((c) => packCustomer({ ...c, contact_name: c.contact_name ?? null, city: c.city ?? null, state: c.state ?? null, needs_qb_setup: c.needs_qb_setup ?? false })) : null}
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
      draft={draft}
      reorderNo={reorderData?.order_no ?? null}
      reorderCompany={reorderData?.company_id ?? null}
      initialSearch={sp.q ?? ""}
      stock={stock}
    />
  );
}
