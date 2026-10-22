import type { Order, OrderStage } from "@/lib/types";

// The order desk: where each order sits after it's placed, and who moves it on.
//   customer approval -> AMBIT PO # (CRM) -> credit check (Accounting) -> scheduled (CRM) -> completed

export const STAGES: Record<OrderStage, { label: string; short: string; pill: string }> = {
  customer: { label: "Waiting on the customer", short: "With customer", pill: "pill warn" },
  needs_po: { label: "Needs AMBIT PO #", short: "Needs PO", pill: "pill" },
  credit: { label: "Waiting on credit check", short: "Credit check", pill: "pill warn" },
  hold: { label: "On credit hold", short: "On hold", pill: "pill" },
  schedule: { label: "Released, needs a date", short: "To schedule", pill: "pill warn" },
  scheduled: { label: "Scheduled", short: "Scheduled", pill: "pill ok" },
  completed: { label: "Completed", short: "Completed", pill: "pill ok" },
  cancelled: { label: "Cancelled", short: "Cancelled", pill: "pill grey" },
};

/** The database works the stage out; this is the same rule for older rows and previews. */
export function stageOf(o: Pick<Order, "status" | "approval_status" | "ambit_po" | "credit_status" | "scheduled_for" | "stage">): OrderStage | null {
  if (o.stage) return o.stage;
  if (o.ambit_po === undefined) return null; // the order desk update (0011) hasn't been run
  if (o.status === "cancelled") return "cancelled";
  if (o.status === "completed") return "completed";
  if (o.approval_status === "pending" || o.approval_status === "changes_requested") return "customer";
  if (!o.ambit_po) return "needs_po";
  if (o.credit_status === "hold") return "hold";
  if (o.credit_status !== "approved") return "credit";
  if (!o.scheduled_for) return "schedule";
  return "scheduled";
}

/** What a contractor sees about their order's progress. */
export function customerProgress(o: Order): string | null {
  const st = stageOf(o);
  if (!st) return null;
  if (st === "customer") return "Waiting for your approval";
  if (st === "scheduled" && o.scheduled_for) {
    return o.delivery_method === "pickup" ? "Ready for pickup on the scheduled date" : "Scheduled for delivery";
  }
  if (st === "completed") return o.delivery_method === "pickup" ? "Picked up" : "Delivered";
  if (st === "cancelled") return "Cancelled";
  return "Approved, AMBIT is processing it";
}
