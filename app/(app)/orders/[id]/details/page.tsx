import { notFound, redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { orderNo } from "@/lib/format";
import { packCustomer } from "@/lib/customers";
import { EditTabs } from "@/components/order2/edit-tabs";
import { OrderDetailsForm } from "@/components/order-details-form";
import type { Order } from "@/lib/types";

export const metadata = { title: "Order details" };
export const dynamic = "force-dynamic";

/** Change an order's details (0076): ship-to for staff who edit orders, everything for admins. */
export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();
  const admin = profile.role === "admin";
  if (!isEmployee(profile) || !(admin || can(profile, "ordering") || can(profile, "order_desk"))) redirect(`/orders/${id}`);
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) notFound();
  if (order.status === "cancelled" && !admin) {
    redirect(`/orders/${id}?err=${encodeURIComponent("This order was cancelled. Only an admin can change it.")}`);
  }
  const [{ data: branches }, { data: companies }, { count: done }] = await Promise.all([
    supabase.from("branches").select("id, name, state").order("sort"),
    admin
      ? supabase.from("companies").select("id, name, account_no, contact_name, city, state, default_branch_id, needs_qb_setup").eq("active", true).order("name").range(0, 4999)
      : Promise.resolve({ data: [] }),
    supabase.from("inventory_lines").select("id", { count: "exact", head: true }).eq("order_id", id).eq("state", "done"),
  ]);
  // 0084: went out with no location on it (an older order) and nothing in stock tied to it: an admin can say where from.
  const { count: anyLines } = order.status === "completed" && !order.branch_id
    ? await supabase.from("inventory_lines").select("id", { count: "exact", head: true }).eq("order_id", id).neq("state", "cancelled")
    : { count: 1 };
  const noPlace = admin && order.status === "completed" && !order.branch_id && !anyLines;
  const open = order.status === "new" || order.status === "processing";
  // Moving where it ships from moves the stock it holds: only before anything is picked up.
  const canMove = (open && !done) || noPlace;
  const o = order as Order & { pay_cod?: boolean; pay_no_checks?: boolean; pay_prepaid?: boolean; invoice_no?: string | null };
  // The customer on the order may no longer be active: keep it in the list so it shows.
  const list = (companies ?? []) as Parameters<typeof packCustomer>[0][];
  if (admin && order.company_id && !list.some((c) => c.id === order.company_id)) {
    list.unshift({ id: order.company_id, name: order.company_name, account_no: order.account_no, contact_name: null, city: null, state: null, default_branch_id: null, needs_qb_setup: false });
  }

  return (
    <main className="shell wide">
      <EditTabs
        id={id}
        title={`Edit ${orderNo(order.order_no)}`}
        on="details"
        details
        items={order.status !== "cancelled" && (order.status !== "completed" ? admin || can(profile, "ordering") || can(profile, "order_desk") : admin)}
        help={admin
          ? "Change anything here, then tap Save. No admin approval needed; once it's in QuickBooks the order desk is emailed to check the invoice."
          : "Change where it ships to, then tap Save. Only an admin can change the customer, location, PO, dates or notes."}
      />
      <div style={{ maxWidth: 760, width: "100%" }}>
      <OrderDetailsForm
        admin={admin}
        order={{
          id: order.id,
          company_id: order.company_id,
          company_name: order.company_name,
          delivery_method: order.delivery_method,
          branch_id: order.branch_id,
          ship_address: order.ship_address,
          po_number: order.po_number,
          needed_by: order.needed_by,
          notes: order.notes,
          ambit_po: order.ambit_po ?? null,
          invoice_no: o.invoice_no ?? null,
          pay_cod: Boolean(o.pay_cod),
          pay_no_checks: Boolean(o.pay_no_checks),
          pay_prepaid: Boolean(o.pay_prepaid),
          status: order.status,
        }}
        branches={((branches ?? []) as { id: string; name: string; state: string }[]).map((b) => ({ id: b.id, name: `${b.name}, ${b.state}` }))}
        companies={list.map(packCustomer)}
        canMove={canMove}
        firstPlace={noPlace}
        moveWhy={
          canMove ? null : !open ? `This order is ${order.status === "completed" ? "already picked up or shipped out" : "cancelled"}, so where it ships from can't change.` : "Some of it was already picked up on the spreadsheet, so where it ships from can't change."
        }
      />
      </div>
    </main>
  );
}
