import type { Order, OrderStage } from "@/lib/types";
import type { OrderEdit } from "@/lib/order-edit";
import { dateShort } from "@/lib/format";
import { stageOf } from "@/lib/order-desk";

// The order's Flow view: every step of its life cycle, who does it (lanes), which are done, which one is up now.

export const LANES = ["Customer & sales rep", "Order desk", "Accounting", "Warehouse", "Admin"] as const;

export type FlowState = "done" | "now" | "next" | "skip";
export type FlowStep = { key: string; lane: number; row: number; title: string; sub: string; state: FlowState; warn?: boolean };
export type FlowEdge = { from: string; to: string; style: "solid" | "dashed"; label?: string; route: "down" | "elbow" | "hold" | "release" | "back" | "admin" };
export type FlowAction = { href: string; label: string; icon: "print" | "pen" | "details"; primary?: boolean; blank?: boolean };
export type FlowModel = {
  steps: FlowStep[];
  edges: FlowEdge[];
  /** The main path, in order (for "Step 5 of 8" and the phone list). */
  path: string[];
  stepNo: number | null;
  total: number;
  lane: number | null;
  upNow: { team: string; text: string; lines: string[]; actions: FlowAction[] } | null;
  finished: string | null;
  cancelled: string | null;
};

export type FlowInput = {
  order: Order;
  branchName: string | null;
  edits: OrderEdit[];
  signedOnScreen: boolean;
  bolFiles: number;
  load: string[];
  canSign: boolean;
};

const d = (s: string | null | undefined) => (s ? dateShort(s) : "");
const join = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(" · ");

export function orderFlow(x: FlowInput): FlowModel {
  const o = x.order;
  const st: OrderStage | null = stageOf(o);
  const pickup = o.delivery_method === "pickup";
  const drop = o.delivery_method === "dropship";
  const cancelled = o.status === "cancelled";
  const completed = o.status === "completed";
  const outWord = pickup ? "Picked up" : drop ? "Shipped from the supplier" : "Shipped out";
  const adminEdits = x.edits.filter((e) => e.admin_needed);
  const waiting = adminEdits.filter((e) => !e.admin_approved_at);
  const at = (...stages: OrderStage[]) => st !== null && stages.includes(st);
  const apStatus = o.approval_status ?? "not_required";
  const approved = apStatus === "approved" || apStatus === "not_required";

  const steps: FlowStep[] = [];
  const add = (s: FlowStep) => steps.push(s);
  add({ key: "placed", lane: 0, row: 0, title: "Order placed", sub: join(o.placed_by_name ?? (o.placed_by_role === "customer" ? "Customer" : "Sales rep"), d(o.created_at)), state: "done" });
  add({
    key: "approve",
    lane: 0,
    row: 1,
    title: "Customer approves",
    sub: at("customer")
      ? apStatus === "changes_requested" ? "Asked for changes" : join("Waiting", o.approval_sent_at && `emailed ${d(o.approval_sent_at)}`)
      : apStatus === "not_required" ? "Placed by the customer"
      : join(o.approval_method === "email_link" ? "Email link" : o.approval_method === "in_app" ? "In the app" : o.approval_method === "staff_recorded" ? "Recorded by AMBIT" : "Approved", d(o.approved_at)),
    state: at("customer") ? "now" : approved || o.ambit_po ? "done" : "next",
  });
  add({
    key: "so",
    lane: 1,
    row: 2,
    title: at("invoice_update") ? "Invoice update" : "SO #, invoice, prices",
    sub: at("invoice_update") ? "Order edited: update the invoice" : o.ambit_po ? join(`SO ${o.ambit_po}`, o.invoice_no && `Inv ${o.invoice_no}`) : "Order desk",
    state: at("needs_po", "invoice_update") ? "now" : o.ambit_po ? "done" : "next",
  });
  add({
    key: "credit",
    lane: 2,
    row: 3,
    title: "Credit check",
    sub: o.credit_status === "approved" ? join("Released", d(o.credit_at)) : at("credit") ? (o.pay_waiting_at ? "Waiting on payment" : "Accounting") : "Accounting",
    state: at("credit") ? "now" : o.credit_status === "approved" ? "done" : "next",
  });
  add({
    key: "hold",
    lane: 2,
    row: 4,
    title: "Credit hold",
    sub: at("hold") ? join("On hold", d(o.credit_at)) : o.credit_status === "approved" ? "Not needed" : "Only if accounting holds it",
    state: at("hold") ? "now" : "skip",
  });
  add({
    key: "date",
    lane: 1,
    row: 5,
    title: `${pickup ? "Pickup" : drop ? "Ship" : "Delivery"} date set`,
    sub: o.scheduled_for ? join(d(o.scheduled_for), pickup ? x.branchName : null) : "Order desk",
    state: at("schedule") ? "now" : o.scheduled_for || completed ? "done" : "next",
  });
  const loadNow = at("scheduled") && !completed && !cancelled;
  add({
    key: "pick",
    lane: 3,
    row: 6,
    title: drop ? "Supplier ships it" : "Pick & print slip",
    sub: completed ? "Done" : loadNow ? (waiting.length ? "Waiting on an admin" : `Now · ${drop ? "Order desk" : "Warehouse"}`) : drop ? "Ships from the supplier" : "Warehouse",
    state: completed ? "done" : loadNow ? (waiting.length ? "next" : "now") : "next",
  });
  add({
    key: "sign",
    lane: 3,
    row: 7,
    title: x.signedOnScreen ? "Signed on screen" : "Signed BOL",
    sub: completed
      ? x.signedOnScreen ? "AMBIT + driver" : x.bolFiles ? `${x.bolFiles} photo${x.bolFiles === 1 ? "" : "s"} attached` : "None attached!"
      : drop ? "Not needed" : "Sign on screen or attach",
    state: completed ? "done" : drop ? "skip" : "next",
    warn: completed && !x.signedOnScreen && !x.bolFiles && !drop,
  });
  add({ key: "out", lane: 3, row: 8, title: outWord, sub: completed ? d(o.completed_at) : "Order complete", state: completed ? "done" : "next" });
  // Admin: an item change waits for an admin (QuickBooks invoice checked) before anything is loaded (0075).
  if (adminEdits.length) {
    const last = adminEdits[adminEdits.length - 1];
    add({ key: "changed", lane: 4, row: 2, title: "Items changed", sub: join(`${adminEdits.length} change${adminEdits.length === 1 ? "" : "s"}`, d(last.edited_at)), state: "done" });
    add({
      key: "admin",
      lane: 4,
      row: 3,
      title: "Admin approves",
      sub: waiting.length ? "Waiting · QuickBooks check" : join(last.admin_approved_by_name ?? "Approved", d(last.admin_approved_at)),
      state: waiting.length ? (cancelled ? "skip" : "now") : "done",
    });
  } else {
    add({ key: "changed", lane: 4, row: 2, title: "Item changes", sub: "None so far", state: "skip" });
    add({ key: "admin", lane: 4, row: 3, title: "Admin approves", sub: "Only if items change", state: "skip" });
  }
  if (cancelled) for (const s of steps) if (s.state !== "done") s.state = "skip";

  const edges: FlowEdge[] = [
    { from: "placed", to: "approve", style: "solid", route: "down" },
    { from: "approve", to: "placed", style: "dashed", route: "back", label: "changes" },
    { from: "approve", to: "so", style: "solid", route: "elbow" },
    { from: "so", to: "credit", style: "solid", route: "elbow" },
    { from: "credit", to: "hold", style: "dashed", route: "hold", label: "hold" },
    { from: "hold", to: "credit", style: "dashed", route: "release", label: "released" },
    { from: "credit", to: "date", style: "solid", route: "elbow" },
    { from: "date", to: "pick", style: "solid", route: "elbow" },
    { from: "pick", to: "sign", style: "solid", route: "down" },
    { from: "sign", to: "out", style: "solid", route: "down" },
    { from: "changed", to: "admin", style: adminEdits.length ? "solid" : "dashed", route: "down" },
    { from: "admin", to: "pick", style: adminEdits.length ? "solid" : "dashed", route: "admin", label: "unlocks the slip" },
  ];

  const path = ["placed", "approve", "so", "credit", "date", "pick", "sign", "out"];
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const firstOpen = path.findIndex((k) => byKey.get(k)!.state !== "done" && byKey.get(k)!.state !== "skip");
  const stepNo = cancelled || firstOpen < 0 ? null : firstOpen + 1;

  // Up now: who, what, and the buttons for it.
  const details: FlowAction = { href: `/orders/${o.id}`, label: "Do it on Details", icon: "details" };
  let upNow: FlowModel["upNow"] = null;
  const team = (t: string) => t;
  if (!cancelled && !completed) {
    if (waiting.length) {
      upNow = { team: team("Admin"), text: "The order was changed. An admin approves it (QuickBooks invoice checked) before anything is printed or loaded.", lines: [], actions: [{ ...details, label: "Approve on Details", primary: true }] };
    } else if (st === "customer") {
      upNow = {
        team: team("Customer & sales rep"),
        text: apStatus === "changes_requested" ? "The customer asked for changes: the sales rep edits the order and sends it again." : `Waiting for ${o.company_name} to approve the order${o.approval_sent_at ? ` (emailed ${d(o.approval_sent_at)})` : ""}.`,
        lines: [],
        actions: [details],
      };
    } else if (st === "needs_po") {
      upNow = { team: team("Order desk"), text: "Enter the Sales Order #, the Invoice # and the invoice prices.", lines: [], actions: [{ ...details, primary: true }] };
    } else if (st === "invoice_update") {
      upNow = { team: team("Order desk"), text: "The order was edited: update the QuickBooks invoice to match, then mark it updated.", lines: [], actions: [{ ...details, primary: true }] };
    } else if (st === "credit") {
      upNow = { team: team("Accounting"), text: o.pay_waiting_at ? "Waiting on the customer's payment before releasing it." : "Check the customer's credit and release the order (or put it on hold).", lines: [], actions: [{ ...details, primary: true }] };
    } else if (st === "hold") {
      upNow = { team: team("Accounting"), text: `On credit hold${o.credit_note ? `: ${o.credit_note}` : ""}. Release it once the customer is cleared.`, lines: [], actions: [{ ...details, primary: true }] };
    } else if (st === "schedule") {
      upNow = { team: team("Order desk"), text: `Set the ${pickup ? "pickup" : "delivery"} date.`, lines: [], actions: [{ ...details, primary: true }] };
    } else if (st === "scheduled") {
      upNow = drop
        ? { team: team("Order desk"), text: "It ships from the supplier: mark it shipped once it has.", lines: [], actions: [{ ...details, primary: true }] }
        : {
            team: team(`Warehouse${x.branchName ? `, ${x.branchName}` : ""}`),
            text: `${pickup ? "Pick" : "Load"} the order${o.scheduled_for ? ` for ${d(o.scheduled_for)}` : ""}: print the packing slip, load it, and get it signed.`,
            lines: x.load,
            actions: [
              { href: `/orders/${o.id}/packing-slip`, label: "Print packing slip", icon: "print", primary: true, blank: true },
              ...(x.canSign ? [{ href: `/orders/${o.id}/sign`, label: "Sign on screen", icon: "pen" as const }] : []),
              details,
            ],
          };
    }
  }
  const lane = upNow ? (steps.find((s) => s.state === "now")?.lane ?? null) : null;
  return {
    steps,
    edges,
    path,
    stepNo,
    total: path.length,
    lane,
    upNow,
    finished: completed ? `${outWord}${o.completed_at ? ` ${d(o.completed_at)}` : ""}` : null,
    cancelled: cancelled ? join(`Cancelled${o.cancelled_at ? ` ${d(o.cancelled_at)}` : ""}`, o.cancelled_by_name, o.cancel_reason) : null,
  };
}
