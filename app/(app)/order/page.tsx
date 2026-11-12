import { redirect } from "next/navigation";
import { holidaySettings } from "@/lib/holidays-server";
import { closuresAround } from "@/lib/holidays";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { OrderBuilder, type CatalogProduct, type FoamLot, type OrderDraft, type StockMap } from "@/components/order-builder";
import { approvalsEnabled } from "@/lib/order-send";
import { saleOn, todayCentral } from "@/lib/sale";
import { packCustomer } from "@/lib/customers";
import { smartDraft } from "@/lib/reorder";
import { stockRows } from "@/lib/inventory/carried";
import { soldByProduct } from "@/lib/inventory/reorder";
import type { Staff } from "@/components/rep-options";
import type { Branch, Category, Company, Product } from "@/lib/types";

export const metadata = { title: "Order" };

export default async function OrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  if (emp && !can(profile, "ordering")) redirect("/");

  const [{ data: products }, { data: categories }, { data: branches }, companiesRes, myCompanyRes, reorderRes, { data: brandRows }, lotsRes, staffRes] = await Promise.all([
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
    // Staff: the ISO brands (stocked under "ISO A-Side", never sold by name) for a custom foam order.
    emp ? supabase.from("products").select("*").eq("active", false).not("stock_of", "is", null).order("name") : Promise.resolve({ data: null }),
    // Staff: every lot / batch with drums left at each location, so a custom foam order can name the exact drums.
    emp ? supabase.rpc("order_lot_choices", { p_branch: null }) : Promise.resolve({ data: null }),
    // Staff: who can get credit for an order (the required Sales rep box).
    emp
      ? supabase.from("profiles").select("id, full_name, email, job_role").in("role", ["employee", "admin"]).eq("status", "active").eq("demo", false).order("full_name")
      : Promise.resolve({ data: null }),
  ]);
  // Staff: what sells most at each location (last 90 days), for the "Most popular" box on the order screen.
  const popular: Record<string, { id: string; n: number }[]> = {};
  if (emp) {
    await Promise.all(
      ((branches ?? []) as Branch[]).map(async ({ id: b }) => {
        const { data } = await supabase.rpc("sold_by_product", { p_branch: b, p_days: 90 });
        const rows = ((data ?? []) as { product_id: string; qty: number; orders: number }[]).sort((x, y) => y.orders - x.orders || Number(y.qty) - Number(x.qty));
        if (rows.length) popular[b] = rows.slice(0, 16).map((r) => ({ id: r.product_id, n: r.orders }));
      }),
    );
  }
  const lots: Record<string, FoamLot[]> = {};
  for (const r of ((lotsRes.data ?? []) as (Omit<FoamLot, "id" | "available" | "remaining"> & { lot_id: number; branch_id: string; available: number | string; remaining: number | string })[])) {
    (lots[r.branch_id] ??= []).push({
      id: r.lot_id,
      product_id: r.product_id,
      sku: r.sku,
      lot_no: r.lot_no,
      mfg: r.mfg,
      exp: r.exp,
      use_by: r.use_by,
      remaining: Number(r.remaining),
      available: Math.max(0, Math.floor(Number(r.available))),
      expired: r.expired,
    });
  }

  // Live stock for every location with an inventory spreadsheet. Staff see the numbers; contractors only
  // In stock / Low stock / Ships from supplier (the database decides what each gets). It's also each location's
  // item list: ordering only offers what's on that location's spreadsheet.
  const stock: StockMap = {};
  await Promise.all(
    ((branches ?? []) as Branch[]).map(async ({ id: b }) => {
      const data = await stockRows(supabase, b);
      if (!data.length) return;
      stock[b] = Object.fromEntries(
        data.map((r) => [
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
  // Custom foam order: ISO (A side) and resin (B side) drums and totes, picked one by one.
  const foamOf = (p: Product): "iso" | "resin" | undefined => {
    if (!["ambit-foam", "alpha-chemicals"].includes(p.category_id ?? "") || !/^(drum|tote)s?$/i.test(p.unit)) return undefined;
    // Staff pick the brand (the store's single "ISO A-Side" stays off their list); contractors get ISO A-Side,
    // since brands are never shown to them (AMBIT picks the brand and lot).
    if (p.sku.trim().toUpperCase() === "ISO") return emp ? undefined : "iso";
    return /\bISO\b/i.test(`${p.sku} ${p.name}`.replace(/-/g, " ")) ? "iso" : "resin";
  };
  const brands = ((brandRows ?? []) as Product[]).map((p) => ({ ...p, custom: true }));
  const catalog: CatalogProduct[] = ([...((products ?? []) as Product[]), ...brands] as (Product & { custom?: boolean })[]).map((p) => {
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
      foam: foamOf(p),
      custom: p.custom || undefined,
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
      closures={closuresAround(todayCentral(), await holidaySettings(supabase))}
      canAddCustomers={emp && can(profile, "add_customers")}
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
      popular={popular}
      lots={emp ? lots : undefined}
      staff={emp ? ((staffRes.data ?? []) as Staff[]) : undefined}
    />
  );
}
