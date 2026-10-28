import type { Branch, Order, OrderItem } from "@/lib/types";
import type { FoamSide, LotPick } from "@/lib/order-doc/loads";

/** Where an order stands from the customer's point of view. */
export type DocState = "pending" | "approved" | "changes_requested" | "expired" | "cancelled" | "closed";

export type DocItem = Pick<OrderItem, "id" | "sku" | "name" | "unit" | "qty" | "unit_price" | "customer_priced" | "line_total" | "price_parts"> & {
  foam?: FoamSide;
  /** Brand and lot each drum comes from: the warehouse copy only (AMBIT staff). */
  picks?: LotPick[];
};

export type DocCompany = {
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  bill_address: string | null;
};

/** Everything the printed order, the emails and the approval page need. */
export type OrderDoc = {
  order: Omit<Order, "placed_by"> & { placed_by?: string | null };
  items: DocItem[];
  branch: Branch | null;
  company: DocCompany | null;
  state: DocState;
};

export function docState(o: Pick<Order, "status" | "approval_status" | "approval_expires_at">): DocState {
  if (o.status === "cancelled") return "cancelled";
  const a = o.approval_status ?? "not_required";
  if (a === "approved") return "approved";
  if (a === "changes_requested") return "changes_requested";
  if (a === "pending") {
    return o.approval_expires_at && new Date(o.approval_expires_at).getTime() < Date.now() ? "expired" : "pending";
  }
  return "closed";
}

/** True while the customer still has to approve (the copy they get, not the warehouse copy). */
export const awaitingCustomer = (s: DocState) => s === "pending" || s === "changes_requested" || s === "expired";
