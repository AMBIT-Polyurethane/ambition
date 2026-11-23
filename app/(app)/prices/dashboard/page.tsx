import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet, Sheet, Tags } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { allRows, basisFor, canPrice, type PriceBatch, type PriceItem } from "@/lib/prices";
import { TopBar } from "@/components/ui";
import { PricingDashboard, type DashCust, type DashItem } from "@/components/prices/pricing-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pricing dashboard" };

/** Change many prices at once: pick customers (or the base prices), pick items or whole groups, raise or set them. */
export default async function PricingDashboardPage() {
  const { supabase, profile } = await requireEmployee();
  if (!canPrice(profile)) redirect("/customers");
  await supabase.rpc("price_apply_due");
  const [custs, items, { data: cats }, own, { data: staff }, base, batchRes, pendRes] = await Promise.all([
    allRows<{ id: string; name: string; state: string | null; sales_rep_id: string | null; distributor: boolean | null }>((f, t) =>
      supabase.from("companies").select("id, name, state, sales_rep_id, distributor").eq("active", true).order("name").range(f, t)),
    allRows<PriceItem>((f, t) => {
      let q = supabase.from("products").select("*").eq("active", true).is("stock_of", null);
      if (profile.role !== "admin") q = q.eq("admin_only", false);
      return q.order("sort").order("name").range(f, t);
    }),
    supabase.from("categories").select("id, name, sort").order("sort"),
    allRows<{ company_id: string }>((f, t) => supabase.from("customer_prices").select("company_id").order("id").range(f, t), 300000),
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]),
    allRows<{ product_id: string; price: number; basis: string }>((f, t) => supabase.from("base_prices").select("product_id, price, basis").range(f, t)),
    supabase.from("price_batches").select("*").order("created_at", { ascending: false }).limit(25),
    supabase.from("price_changes").select("batch_id, effective_on").is("applied_at", null).is("cancelled_at", null).limit(100000),
  ]);
  const rep = new Map(((staff ?? []) as { id: string; full_name: string | null; email: string }[]).map((s) => [s.id, s.full_name || s.email]));
  const ownCount = new Map<string, number>();
  for (const r of own) ownCount.set(r.company_id, (ownCount.get(r.company_id) ?? 0) + 1);
  const customers: DashCust[] = custs.map((c) => ({
    id: c.id, name: c.name, state: c.state ?? "", rep: c.sales_rep_id ? rep.get(c.sales_rep_id) ?? "" : "", distributor: Boolean(c.distributor), own: ownCount.get(c.id) ?? 0,
  }));
  const baseOf = new Map(base.map((b) => [b.product_id, Number(b.price)]));
  const list: DashItem[] = items.map((p) => {
    const basis = basisFor(p);
    return { id: p.id, sku: p.sku, name: p.name, unit: p.unit, category_id: p.category_id, basis, base: baseOf.get(p.id) ?? (basis === "unit" && p.list_price !== null ? Number(p.list_price) : null) };
  });
  const pending = new Map<number, { count: number; on: string }>();
  for (const r of (pendRes.data ?? []) as { batch_id: number; effective_on: string }[]) {
    const x = pending.get(r.batch_id) ?? { count: 0, on: r.effective_on };
    x.count++;
    pending.set(r.batch_id, x);
  }
  const ready = !batchRes.error;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return (
    <main className="shell full">
      <TopBar
        title="Pricing dashboard"
        back="/prices"
        right={
          <div className="row" style={{ gap: 8 }}>
            <Link href="/prices/base" className="btn sm ghost"><Tags size={15} /> Base prices</Link>
            <Link href="/prices/import" className="btn sm ghost"><FileSpreadsheet size={15} /> Import foam sheet</Link>
            <Link href="/prices" className="btn sm ghost"><Sheet size={15} /> Master sheet</Link>
          </div>
        }
      />
      {!ready ? <div className="alert warn small">The pricing dashboard needs the 0106 database update first (Supabase &gt; SQL Editor).</div> : null}
      <PricingDashboard
        customers={customers}
        items={list}
        cats={(cats ?? []) as { id: string; name: string }[]}
        batches={((batchRes.data ?? []) as PriceBatch[]).map((b) => ({ ...b, amount: Number(b.amount), pending: pending.get(b.id)?.count ?? 0 }))}
        today={today}
      />
    </main>
  );
}
