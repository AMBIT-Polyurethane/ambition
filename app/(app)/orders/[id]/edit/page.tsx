import { notFound, redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { orderNo } from "@/lib/format";
import { STAGES, stageOf } from "@/lib/order-desk";
import { carriedAt } from "@/lib/inventory/carried";
import { EditTabs } from "@/components/order2/edit-tabs";
import type { SheetLot, SheetProduct, SheetStart } from "@/components/order-sheet";
import { EditOrder } from "@/components/order2/edit-order";
import { packCustomer } from "@/lib/customers";
import { editable } from "@/lib/order-edit";
import type { Order, OrderItem } from "@/lib/types";

export const metadata = { title: "Edit order" };
export const dynamic = "force-dynamic";

/** AMBIT staff: edit an order like a sheet (0086). Any rows, any item in inventory, each row on its own lot. */
export default async function EditOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const admin = profile.role === "admin";
  const staffEdit = isEmployee(profile) && (admin || can(profile, "ordering") || can(profile, "order_desk"));
  if (!staffEdit) redirect(`/orders/${id}`);
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) notFound();
  const closed = order.status === "completed";
  // Items and lots: open orders (admins, Ordering, the order desk); a completed one only an admin corrects (0046).
  const canItems = order.status !== "cancelled" && (closed ? admin : editable(order));
  // Customer, ship-to, location, PO, dates (0076): ship-to for anyone who edits orders, everything for admins.
  const canDetails = admin || (order.status !== "cancelled" && order.delivery_method !== "pickup");
  if (!canItems && !canDetails) {
    redirect(`/orders/${id}?err=${encodeURIComponent(order.status === "cancelled" ? "This order was cancelled. Place a new order instead." : "Only an admin can correct a completed order.")}`);
  }
  const [{ data: itemRows }, { data: lineRows }, carried, { data: products }, { data: lotRows }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", id).order("id"),
    supabase.from("inventory_lines").select("order_item_id, qty, lot_id, state").eq("order_id", id).in("state", closed ? ["done"] : ["reserved"]),
    carriedAt(supabase, order.branch_id),
    // Every product, hidden ones too: the ISO brands are hidden from the catalog but their lots are what went out.
    canItems ? supabase.from("products").select("id, sku, name, unit, stock_of, active").order("sort").order("name") : Promise.resolve({ data: [] }),
    canItems && order.branch_id
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
  // The details part (the same as the old Details page).
  let details: React.ComponentProps<typeof EditOrder>["details"] = null;
  if (canDetails) {
    const [{ data: branches }, { data: companies }, { count: done }] = await Promise.all([
      supabase.from("branches").select("id, name, state").order("sort"),
      admin
        ? supabase.from("companies").select("id, name, account_no, contact_name, city, state, default_branch_id, needs_qb_setup").eq("active", true).order("name").range(0, 4999)
        : Promise.resolve({ data: [] }),
      supabase.from("inventory_lines").select("id", { count: "exact", head: true }).eq("order_id", id).eq("state", "done"),
    ]);
    const { count: anyLines } = closed && !order.branch_id
      ? await supabase.from("inventory_lines").select("id", { count: "exact", head: true }).eq("order_id", id).neq("state", "cancelled")
      : { count: 1 };
    const noPlace = admin && closed && !order.branch_id && !anyLines;
    const open = order.status === "new" || order.status === "processing";
    const canMove = (open && !done) || noPlace;
    const o = order as Order & { pay_cod?: boolean; pay_no_checks?: boolean; pay_prepaid?: boolean; invoice_no?: string | null };
    const list = (companies ?? []) as Parameters<typeof packCustomer>[0][];
    if (admin && order.company_id && !list.some((c) => c.id === order.company_id)) {
      list.unshift({ id: order.company_id, name: order.company_name, account_no: order.account_no, contact_name: null, city: null, state: null, default_branch_id: null, needs_qb_setup: false });
    }
    details = {
      admin,
      order: {
        id: order.id, company_id: order.company_id, company_name: order.company_name, delivery_method: order.delivery_method, branch_id: order.branch_id,
        ship_address: order.ship_address, po_number: order.po_number, needed_by: order.needed_by, notes: order.notes, ambit_po: order.ambit_po ?? null,
        invoice_no: o.invoice_no ?? null, pay_cod: Boolean(o.pay_cod), pay_no_checks: Boolean(o.pay_no_checks), pay_prepaid: Boolean(o.pay_prepaid), status: order.status,
      },
      branches: ((branches ?? []) as { id: string; name: string; state: string }[]).map((b) => ({ id: b.id, name: `${b.name}, ${b.state}` })),
      companies: list.map(packCustomer),
      canMove,
      firstPlace: noPlace,
      moveWhy: canMove ? null : !open ? `This order is ${closed ? "already picked up or shipped out" : "cancelled"}, so where it ships from can't change.` : "Some of it was already picked up on the spreadsheet, so where it ships from can't change.",
    };
  }

  return (
    <main className="shell wide">
      <EditTabs
        id={id}
        title={`Edit ${orderNo(order.order_no)}`}
        on="items"
        items={false}
        details={false}
        help={<>{order.company_name} · revision {order.revision ?? 1}. Change anything on either tab, then tap Save once at the bottom.</>}
      />
      {canItems && !order.branch_id && order.delivery_method !== "dropship" ? (
        <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>This order has no location, so no lots show. Set its Location on the Customer, ship-to &amp; dates tab and Save first.</span></div>
      ) : null}
      <EditOrder
        id={id}
        start={sp.tab === "details" ? "details" : "items"}
        items={canItems ? { closed, next, products: choices, lots, start, noneRecorded } : null}
        details={details}
      />
    </main>
  );
}
