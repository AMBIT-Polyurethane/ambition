import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LayoutDashboard, Sheet } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit } from "@/lib/credit";
import { allRows, basisFor, canPrice, type Basis, type CustPrice, type PendingChange, type PriceItem } from "@/lib/prices";
import { TopBar } from "@/components/ui";
import { CustomerPrices } from "@/components/prices/customer-prices";
import { PriceNote } from "@/components/prices/price-note";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer prices" };

/** What this customer pays for every item: their own price, or the base price. Price approvers and admins change them. */
export default async function CustomerPricesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireEmployee();
  const editable = canPrice(profile);
  if (!editable && !canCredit(profile)) redirect("/");
  await supabase.rpc("price_apply_due");
  const [{ data: co }, items, { data: cats }, { data: prices }, baseRows, pendRes] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    allRows<PriceItem>((f, t) => {
      let q = supabase.from("products").select("*").eq("active", true).is("stock_of", null);
      if (profile.role !== "admin") q = q.eq("admin_only", false);
      return q.order("category_id").order("sort").order("name").range(f, t);
    }),
    supabase.from("categories").select("id, name, sort").order("sort"),
    supabase.from("customer_prices").select("*").eq("company_id", id),
    allRows<{ product_id: string; price: number; basis: Basis }>((f, t) => supabase.from("base_prices").select("product_id, price, basis").range(f, t)),
    supabase.from("price_changes").select("batch_id, company_id, product_id, new_price, basis, effective_on").eq("company_id", id).is("applied_at", null).is("cancelled_at", null).order("effective_on"),
  ]);
  if (!co) notFound();
  // Admins only (0091 / 0112): what we pay for each item, and the markups set for this customer by group.
  const admin = profile.role === "admin";
  const [costRows, markRes, vendRes] = admin
    ? await Promise.all([
        allRows<{ product_id: string; cost: number }>((f, t) => supabase.from("product_costs").select("product_id, cost").range(f, t)),
        supabase.from("customer_category_markups").select("category_id, markup_pct, items, set_by_name, set_at").eq("company_id", id),
        supabase.from("vendor_costs").select("product_id, cost").limit(5000),
      ])
    : [[], { data: [], error: null }, { data: [], error: null }];
  const costs: Record<string, number> = {};
  for (const c of costRows) costs[c.product_id] = Number(c.cost);
  // Drop-shipped parts (CFS's gun parts): what we pay is the vendor's price to AMBIT (0114 keeps it admins-only).
  if (admin) {
    const vend = new Map(((vendRes.error ? [] : vendRes.data ?? []) as { product_id: string; cost: number }[]).map((v) => [v.product_id, Number(v.cost)]));
    for (const p of items as unknown as { id: string; drop_ship_partner?: string | null; vendor_cost?: number | null }[]) {
      const v = vend.get(p.id) ?? (p.vendor_cost === null || p.vendor_cost === undefined ? undefined : Number(p.vendor_cost));
      if (v !== undefined && (p.drop_ship_partner || costs[p.id] === undefined)) costs[p.id] = v;
    }
  }
  const markups: Record<string, { pct: number; items: number | null; by: string | null; at: string }> = {};
  for (const m of ((markRes.error ? [] : markRes.data ?? []) as { category_id: string; markup_pct: number; items: number | null; set_by_name: string | null; set_at: string }[])) {
    markups[m.category_id] = { pct: Number(m.markup_pct), items: m.items, by: m.set_by_name, at: m.set_at };
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  // The base price each item falls back to: foam per lb and batts per sq ft from the base price list, else the list price.
  const baseOf = new Map(baseRows.map((b) => [b.product_id, { price: Number(b.price), basis: b.basis }]));
  const base: Record<string, { price: number; basis: Basis }> = {};
  for (const p of items) {
    const b = baseOf.get(p.id);
    if (b) base[p.id] = b;
    else if (basisFor(p) === "unit" && p.list_price !== null) base[p.id] = { price: Number(p.list_price), basis: "unit" };
  }
  const company = co as { id: string; name: string; account_no: string | null; price_note?: string | null };
  return (
    <main className="shell wide">
      <TopBar
        title={`${company.name} · prices`}
        back={`/customers/${id}?tab=prices`}
        right={editable ? (
          <div className="row" style={{ gap: 8 }}>
            <Link href="/prices/dashboard" className="btn sm ghost"><LayoutDashboard size={15} /> Pricing dashboard</Link>
            <Link href={`/prices?q=${encodeURIComponent(company.name)}`} className="btn sm dark"><Sheet size={15} /> Master price sheet</Link>
          </div>
        ) : null}
      />
      <p className="small muted" style={{ margin: 0 }}>
        What {company.name} pays. Type their own price where it differs from the <b>Base</b> price; leave it blank and they pay the base price. Foam is priced <b>per lb</b> and fiberglass <b>per sq ft</b> (we work out the drum, set or bag price for you).
        These prices fill in by themselves when an order is placed for them.{editable ? null : " Only people who can change customer prices change these."}
      </p>
      <PriceNote company={id} note={company.price_note ?? ""} editable={editable} />
      <CustomerPrices admin={admin} costs={costs} markups={markups} company={id} items={items} cats={((cats ?? []) as { id: string; name: string }[])} prices={(prices ?? []) as CustPrice[]} editable={editable} today={today} base={base} pending={(pendRes.error ? [] : pendRes.data ?? []) as PendingChange[]} />
    </main>
  );
}
