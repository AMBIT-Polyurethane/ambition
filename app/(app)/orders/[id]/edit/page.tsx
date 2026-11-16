import { notFound, redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { orderNo } from "@/lib/format";
import { STAGES, stageOf } from "@/lib/order-desk";
import { carriedAt } from "@/lib/inventory/carried";
import { TopBar } from "@/components/ui";
import { OrderEditor, type AddChoice, type EditItem, type LotChoice } from "@/components/order-editor";
import type { Order, OrderItem } from "@/lib/types";

export const metadata = { title: "Edit order" };
export const dynamic = "force-dynamic";

/** AMBIT staff: add items, change or remove quantities on an open order. */
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();
  if (!isEmployee(profile) || !(profile.role === "admin" || can(profile, "ordering") || can(profile, "order_desk"))) redirect(`/orders/${id}`);
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) notFound();
  if (order.status === "cancelled") {
    redirect(`/orders/${id}?err=${encodeURIComponent("This order was cancelled. Place a new order instead.")}`);
  }
  // A completed order (picked up / delivered): only an admin corrects it (0046).
  const closed = order.status === "completed";
  if (closed && profile.role !== "admin") {
    redirect(`/orders/${id}?err=${encodeURIComponent("This order is completed. Only an admin can correct a completed order.")}`);
  }
  const [{ data: itemRows }, { data: picked }, carried, { data: products }, { data: lotRows }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", id).order("id"),
    supabase.from("inventory_lines").select("order_item_id").eq("order_id", id).eq("state", "done"),
    carriedAt(supabase, order.branch_id),
    // Every product, hidden ones too: the ISO brands are hidden from the catalog but their lots are what went out.
    supabase.from("products").select("id, sku, name, unit, stock_of, active").order("sort").order("name"),
    order.branch_id
      ? supabase.from("inventory_lots").select("product_id").eq("branch_id", order.branch_id).eq("on_sheet", true)
      : Promise.resolve({ data: [] as { product_id: string }[] }),
  ]);
  type P = { id: string; sku: string; name: string; unit: string; stock_of: string | null; active: boolean };
  const prods = (products ?? []) as P[];
  // Spray foam counted by lot on FOAM LOTS (every ISO brand, Summer / Winter resin) and the catalog item each sells as.
  const lotIds = new Set(((lotRows ?? []) as { product_id: string }[]).map((l) => l.product_id));
  const byLot = new Set<string>(lotIds);
  for (const p of prods) if (lotIds.has(p.id) && p.stock_of) byLot.add(p.stock_of);
  const done = new Set(((picked ?? []) as { order_item_id: number | null }[]).map((p) => p.order_item_id));
  const items: EditItem[] = ((itemRows ?? []) as OrderItem[]).map((i) => ({
    id: i.id,
    product_id: i.product_id ?? null,
    sku: i.sku,
    name: i.name,
    unit: i.unit,
    qty: Number(i.qty),
    locked: !closed && done.has(i.id) ? "Already picked up on the spreadsheet: can't be changed here." : null,
  }));
  const choices: AddChoice[] = prods
    .filter((p) => p.active && (!carried || carried.has(p.id) || byLot.has(p.id)))
    .map((p) => ({ product_id: p.id, sku: p.sku, name: p.name, unit: p.unit, lots: byLot.has(p.id) }));
  // Correcting a completed order: the lots each spray foam item could have come from (0070).
  const lotChoices: Record<string, LotChoice[]> = {};
  if (closed && order.branch_id && byLot.size) {
    const want = [...new Set([...choices.filter((c) => c.lots).map((c) => c.product_id), ...items.map((i) => i.product_id).filter((x): x is string => !!x)])];
    // Holds for other customers show on each lot (0071); before 0071 the function has no p_company.
    let { data: lc, error: le } = await supabase.rpc("inventory_lot_choices_for", { p_branch: order.branch_id, p_products: want, p_company: order.company_id });
    if (le) ({ data: lc } = await supabase.rpc("inventory_lot_choices_for", { p_branch: order.branch_id, p_products: want }));
    for (const r of (lc ?? []) as (LotChoice & { for_product: string })[]) {
      (lotChoices[r.for_product] ??= []).push({ ...r, remaining: Number(r.remaining), available: Number(r.available) });
    }
  }
  const st = stageOf(order);
  const where = order.delivery_method === "pickup" ? "picked up" : "shipped out";
  const next = closed
    ? `This order was already ${where}. Saving corrects stock${order.branch_id ? ` at ${order.branch_id.toUpperCase()}` : ""}: whatever you change goes back in and the new amount comes out (the spreadsheet updates on its next sync). Then the order desk updates the invoice, and if the total changed the credit team is emailed to collect or credit the difference. Credit isn't checked again, and the customer is emailed the updated order.`
    : st === "customer"
      ? `It's still waiting on the customer: saving sends them a fresh approval email${order.approval_email ? ` (${order.approval_email})` : ""} and the old link stops working.`
      : !order.ambit_po
        ? "The Sales Order # isn't in yet: saving sends the updated order to orders@ambitpu.com. Stock is held for the new amounts right away."
        : `The Invoice # is already in (${st ? STAGES[st].short : ""}): saving sends the order back to the order desk to update the invoice. If the total goes up, accounting checks credit again, and the customer is emailed the updated order once the invoice is updated.`;
  return (
    <main className="shell">
      <TopBar title={`${closed ? "Correct" : "Edit"} ${orderNo(order.order_no)}`} back={`/orders/${id}`} />
      <p className="small muted" style={{ margin: 0 }}>
        {order.company_name} · revision {order.revision ?? 1}. Change a quantity, take an item off (trash can), or add an item, then tap Save changes.
      </p>
      {closed ? (
        <p className="small muted" style={{ margin: 0 }}>
          Wrong brand or lot on an item that&apos;s already here? Go back and use <b>Wrong lot or brand went out?</b> on the order page instead of
          taking it off and adding it again. For spray foam you add or change here, pick the exact lot that went out.
        </p>
      ) : null}
      <OrderEditor orderId={id} items={items} choices={choices} next={next} closed={closed} lotChoices={lotChoices} />
    </main>
  );
}
