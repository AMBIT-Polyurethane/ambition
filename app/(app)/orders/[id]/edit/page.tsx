import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { orderNo } from "@/lib/format";
import { STAGES, stageOf } from "@/lib/order-desk";
import { carriedAt } from "@/lib/inventory/carried";
import { EditTabs } from "@/components/order2/edit-tabs";
import { OrderSheet, type SheetLot, type SheetProduct, type SheetStart } from "@/components/order-sheet";
import type { Order, OrderItem } from "@/lib/types";

export const metadata = { title: "Edit order" };
export const dynamic = "force-dynamic";

/** AMBIT staff: edit an order like a sheet (0086). Any rows, any item in inventory, each row on its own lot. */
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
  const [{ data: itemRows }, { data: lineRows }, carried, { data: products }, { data: lotRows }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", id).order("id"),
    supabase.from("inventory_lines").select("order_item_id, qty, lot_id, state").eq("order_id", id).in("state", closed ? ["done"] : ["reserved"]),
    carriedAt(supabase, order.branch_id),
    // Every product, hidden ones too: the ISO brands are hidden from the catalog but their lots are what went out.
    supabase.from("products").select("id, sku, name, unit, stock_of, active").order("sort").order("name"),
    order.branch_id
      ? supabase.from("inventory_lots").select("id, product_id, sku, lot_no, exp, use_by, remaining, on_sheet").eq("branch_id", order.branch_id)
      : Promise.resolve({ data: [] }),
  ]);
  type P = { id: string; sku: string; name: string; unit: string; stock_of: string | null; active: boolean };
  type L = { id: number; product_id: string; sku: string; lot_no: string | null; exp: string | null; use_by: string | null; remaining: number; on_sheet: boolean };
  type Ln = { order_item_id: number | null; qty: number; lot_id: number | null };
  const prods = (products ?? []) as P[];
  const prodOf = new Map(prods.map((p) => [p.id, p]));
  const items = (itemRows ?? []) as OrderItem[];
  const lines = (lineRows ?? []) as Ln[];
  const usedLots = new Set(lines.map((l) => l.lot_id).filter((x): x is number => !!x));

  // Lots at this location (on FOAM LOTS, plus any an order line is already on), as the item each sells as.
  const lots: SheetLot[] = ((lotRows ?? []) as L[])
    .filter((l) => (l.on_sheet || usedLots.has(l.id)) && prodOf.get(l.product_id))
    .map((l) => {
      const lp = prodOf.get(l.product_id)!;
      return { lot_id: l.id, product_id: lp.stock_of && prodOf.get(lp.stock_of) ? lp.stock_of : lp.id, sku: l.sku, lot_no: l.lot_no, exp: l.exp ?? l.use_by, remaining: Number(l.remaining), on_sheet: l.on_sheet };
    });
  const byLot = new Set(lots.filter((l) => l.on_sheet).map((l) => l.product_id));
  // Anything this location carries, anything counted by lot here, and whatever is on the order already.
  const onOrder = new Set(items.map((i) => i.product_id).filter((x): x is string => !!x));
  const choices: SheetProduct[] = prods
    .filter((p) => !p.stock_of && ((p.active && (!carried || carried.has(p.id))) || byLot.has(p.id) || onOrder.has(p.id)))
    .map((p) => ({ product_id: p.id, sku: p.sku, name: p.name, unit: p.unit, byLot: byLot.has(p.id) }));
  for (const pid of onOrder) {
    const p = prodOf.get(pid);
    if (p && !choices.some((c) => c.product_id === pid)) choices.push({ product_id: p.id, sku: p.sku, name: p.name, unit: p.unit, byLot: byLot.has(p.id) });
  }

  // The rows to start from: each item, split by the lots it's on (held now, or what went out).
  const start: SheetStart[] = [];
  const noneRecorded: string[] = [];
  for (const it of items) {
    const mine = lines.filter((l) => l.order_item_id === it.id);
    const byLotQty = new Map<number, number>();
    for (const l of mine) if (l.lot_id) byLotQty.set(l.lot_id, (byLotQty.get(l.lot_id) ?? 0) + Number(l.qty));
    const onLots = [...byLotQty.values()].reduce((t, q) => t + q, 0);
    const base = { item_id: it.id, product_id: it.product_id ?? null, sku: it.sku, name: it.name, unit: it.unit };
    for (const [lot, q] of byLotQty) start.push({ ...base, lot_id: lot, qty: Math.round(q * 100) / 100 });
    const rest = Math.round((Number(it.qty) - onLots) * 100) / 100;
    if (rest > 0 || !byLotQty.size) start.push({ ...base, lot_id: null, qty: rest > 0 ? rest : Number(it.qty) });
    if (closed && it.product_id && !mine.length) noneRecorded.push(it.product_id);
  }

  const st = stageOf(order);
  const where = order.delivery_method === "pickup" ? "picked up" : "shipped out";
  const next = closed
    ? `This order was already ${where}. Saving corrects stock${order.branch_id ? ` at ${order.branch_id.toUpperCase()}` : ""}: what changed goes back in and what you enter comes out, from the lots on the rows. If the total changed, the order desk updates the invoice and the credit team is emailed to collect or credit the difference.`
    : st === "customer"
      ? `It's still waiting on the customer: saving sends them a fresh approval email${order.approval_email ? ` (${order.approval_email})` : ""} and the old link stops working.`
      : !order.ambit_po
        ? "The Sales Order # isn't in yet: saving sends the updated order to orders@ambitpu.com. Stock is held on the lots you picked right away."
        : `The Invoice # is already in (${st ? STAGES[st].short : ""}): saving sends the order back to the order desk to update the invoice. Changing only the lots doesn't.`;
  return (
    <main className="shell wide">
      <EditTabs
        id={id}
        title={`Edit ${orderNo(order.order_no)}`}
        on="items"
        items
        details={profile.role === "admin" || ((can(profile, "ordering") || can(profile, "order_desk")) && order.delivery_method !== "pickup")}
        help={<>{order.company_name} · revision {order.revision ?? 1}. Add rows, change items, lots and quantities, then tap Save changes.</>}
      />
      {!order.branch_id && order.delivery_method !== "dropship" ? (
        <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>This order has no location, so no lots show. Set its location first: <Link href={`/orders/${id}/details`}>Edit details</Link>, then Location.</span></div>
      ) : null}
      <OrderSheet orderId={id} closed={closed} next={next} products={choices} lots={lots} start={start} noneRecorded={noneRecorded} />
    </main>
  );
}
