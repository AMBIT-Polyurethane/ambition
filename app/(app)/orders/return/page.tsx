import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { inventoryBranches } from "@/lib/widgets";
import { stockItems } from "@/lib/incoming";
import { packCustomer } from "@/lib/customers";
import { saleOn } from "@/lib/sale";
import { orderNo } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { ReturnForm, type Price } from "@/components/return-form";
import type { StockItem } from "@/components/incoming-forms";

export const metadata = { title: "Return or exchange" };
export const dynamic = "force-dynamic";

/** Staff: a return (items come back for credit) or an exchange (items come back, others go out, the customer pays the difference). */
export default async function ReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!(can(profile, "ordering") || can(profile, "order_desk"))) redirect("/");
  const branches = await inventoryBranches(supabase, profile, { all: true });
  // From an order: its customer, location and items (with what they paid) start the form.
  const { data: orig } = sp.order
    ? await supabase.from("orders").select("id, order_no, company_id, company_name, branch_id, order_items(product_id, sku, name, qty, unit, unit_price)").eq("id", sp.order).maybeSingle()
    : { data: null };
  const branch = branches.find((b) => b.id === (sp.b ?? orig?.branch_id)) ?? branches[0];
  if (!branch) redirect("/orders");
  const [items, { data: companies }, { data: prods }] = await Promise.all([
    Promise.all(branches.map(async (b) => [b.id, await stockItems(supabase, b.id)] as const)),
    orig ? Promise.resolve({ data: null }) : supabase.from("companies").select("id, name, account_no, contact_name, city, state, default_branch_id, needs_qb_setup").eq("active", true).order("name"),
    supabase.from("products").select("id, list_price, sale_price, sale_ends, customer_priced, category:categories(customer_priced)").eq("active", true),
  ]);
  type P = { id: string; list_price: number | null; sale_price: number | null; sale_ends: string | null; customer_priced: boolean | null; category: { customer_priced: boolean | null } | null };
  const prices: Record<string, Price> = {};
  for (const p of (prods ?? []) as unknown as P[]) {
    const on = saleOn(p.sale_price, p.sale_ends);
    const account = Boolean(p.customer_priced ?? p.category?.customer_priced) && !on;
    prices[p.id] = { price: account ? null : on ? Number(p.sale_price) : p.list_price === null ? null : Number(p.list_price), account };
  }
  const paid: Record<string, number> = {};
  for (const i of (orig?.order_items ?? []) as { product_id: string | null; unit_price: number | null }[]) if (i.product_id && i.unit_price !== null) paid[i.product_id] = Number(i.unit_price);
  return (
    <main className="shell">
      <TopBar title="Return or exchange" back={orig ? `/orders/${orig.id}` : "/orders"} howTo="returns-exchanges" />
      <p className="small muted" style={{ margin: 0 }}>
        <b>Exchange</b>: items come back and others go out (a drum swap, the wrong item); the customer pays the difference. <b>Return</b>: items come back for
        credit. When the items come back, the warehouse receives them with their lot and expiration, and they go back into stock.
      </p>
      <ReturnForm
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        branch={branch.id}
        items={Object.fromEntries(items) as Record<string, StockItem[]>}
        prices={prices}
        paid={paid}
        companies={(companies ?? []).map((c) => packCustomer(c as Parameters<typeof packCustomer>[0]))}
        original={orig ? { id: orig.id as string, label: `${orderNo(Number(orig.order_no))} · ${orig.company_name}`, company: orig.company_id as string, lines: ((orig.order_items ?? []) as { product_id: string | null; sku: string; name: string; qty: number; unit: string }[]).filter((l) => l.product_id).map((l) => ({ product_id: l.product_id as string, sku: l.sku, name: l.name, qty: Number(l.qty), unit: l.unit })) } : null}
        start={sp.kind === "return" ? "return" : "exchange"}
      />
    </main>
  );
}
