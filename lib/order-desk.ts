import type { Order, OrderStage } from "@/lib/types";
import { can } from "@/lib/access";

// The order desk: where each order sits after it's placed, and who moves it on.
//   customer approval -> Sales Order # (CRM) -> credit check (Accounting) -> scheduled (CRM) -> completed

export const STAGES: Record<OrderStage, { label: string; short: string; pill: string }> = {
  customer: { label: "Waiting on the customer", short: "With customer", pill: "pill warn" },
  needs_po: { label: "Needs Sales Order #", short: "Needs Sales Order #", pill: "pill" },
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

// ------------------------------------------------------------------ who sees which orders
/**
 * The Order Desk for staff: "all" for admins, the order desk (CRM), credit approvals and the warehouse;
 * "mine" for sales reps (the orders they placed, nothing to act on); null for everyone else.
 */
export function deskAccess(p: Parameters<typeof can>[0] & { role: string }): "all" | "mine" | null {
  if (!p || (p.role !== "admin" && p.role !== "employee")) return null;
  if (p.role === "admin" || can(p, "order_desk") || can(p, "credit_check") || can(p, "inventory")) return "all";
  if (can(p, "ordering")) return "mine";
  return null;
}

// ------------------------------------------------------------------ Central-time days
/** "2026-10-21" plus n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The moment a Central-time day starts, as an ISO timestamp (handles daylight saving). */
export function centralStart(day: string): string {
  // 06:00 UTC is midnight in winter (CST) and 1 AM in summer (CDT).
  const probe = new Date(`${day}T06:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(probe));
  return new Date(probe.getTime() - hour * 3600_000).toISOString();
}

/** Since when an open order has been waiting on its current step (same rule as the dashboard). */
export function waitingSince(
  o: Pick<Order, "approval_sent_at" | "approved_at" | "po_at" | "credit_at" | "created_at" | "scheduled_for"> & { stage?: OrderStage | null },
  today: string,
): string | null {
  switch (o.stage) {
    case "customer":
      return o.approval_sent_at ?? o.created_at;
    case "needs_po":
      return o.approved_at ?? o.created_at;
    case "credit":
      return o.po_at ?? o.created_at;
    case "hold":
    case "schedule":
      return o.credit_at ?? o.created_at;
    case "scheduled":
      return o.scheduled_for && o.scheduled_for < today ? centralStart(addDays(o.scheduled_for, 1)) : null;
    default:
      return null;
  }
}
