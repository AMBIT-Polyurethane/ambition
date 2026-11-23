import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet, LayoutDashboard, Tags } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { allRows, canPrice, type Basis, type PriceItem } from "@/lib/prices";
import { TopBar } from "@/components/ui";
import { PriceGrid, type GridCust } from "@/components/prices/price-grid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer prices" };

/** The master price sheet: every customer × every item, typed, pasted or imported in bulk. Admins and price approvers. */
export default async function PricesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canPrice(profile)) redirect("/customers");
  const [custs, items, { data: cats }, prices, { data: staff }] = await Promise.all([
    allRows<{ id: string; name: string; account_no: string | null; qb_name: string | null; sales_rep_id: string | null }>((f, t) =>
      supabase.from("companies").select("id, name, account_no, qb_name, sales_rep_id").eq("active", true).order("name").range(f, t)),
    allRows<PriceItem>((f, t) => {
      let q = supabase.from("products").select("id, sku, name, unit, category_id, list_price, sqft_per_unit").eq("active", true).is("stock_of", null);
      if (profile.role !== "admin") q = q.eq("admin_only", false);
      return q.order("sort").order("name").range(f, t);
    }),
    supabase.from("categories").select("id, name, sort").order("sort"),
    allRows<{ company_id: string; product_id: string; price: number; basis: Basis }>((f, t) => supabase.from("customer_prices").select("company_id, product_id, price, basis").order("id").range(f, t), 200000),
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]),
  ]);
  const rep = new Map(((staff ?? []) as { id: string; full_name: string | null; email: string }[]).map((s) => [s.id, s.full_name || s.email]));
  const customers: GridCust[] = custs.map((c) => ({ id: c.id, name: c.name, account_no: c.account_no, qb_name: c.qb_name, rep: c.sales_rep_id ? rep.get(c.sales_rep_id) ?? null : null }));
  return (
    <main className="shell full">
      <TopBar
        title="Customer prices"
        back="/customers"
        right={
          <div className="row" style={{ gap: 8 }}>
            <Link href="/prices/base" className="btn sm ghost"><Tags size={15} /> Base prices</Link>
            <Link href="/prices/import" className="btn sm ghost"><FileSpreadsheet size={15} /> Import foam sheet</Link>
            <Link href="/prices/dashboard" className="btn sm dark"><LayoutDashboard size={15} /> Pricing dashboard</Link>
          </div>
        }
      />
      <p className="small muted" style={{ margin: 0 }}>
        Every customer&apos;s price on every item. Pick a product group, then type, paste a block from Excel, or <b>Import a spreadsheet</b> (Customer, SKU, Price, and optionally Per: lb / sq ft / unit; or one column per SKU).
        Foam is per lb, fiberglass per sq ft. Approved price requests land here by themselves, and NetSuite will fill it later.
      </p>
      <PriceGrid customers={customers} items={items} cats={(cats ?? []) as { id: string; name: string }[]} prices={prices} initialQ={sp.q ?? ""} />
    </main>
  );
}
