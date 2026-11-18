import Link from "next/link";
import { Check } from "lucide-react";
import type { Order, OrderStage } from "@/lib/types";

/** The 7 steps every order goes through, and which one it's on. */
export function orderSteps(o: Pick<Order, "status" | "delivery_method">, st: OrderStage | null): { labels: string[]; now: number } {
  const last = o.delivery_method === "pickup" ? "Picked up" : o.delivery_method === "dropship" ? "Shipped" : "Delivered";
  const labels = ["Placed", "Approved", "Invoiced", st === "hold" ? "On hold" : "Credit", "Scheduled", o.delivery_method === "dropship" ? "Ship it" : "Load & sign", last];
  const now =
    o.status === "completed" ? 7
    : st === "customer" ? 1
    : st === "needs_po" || st === "invoice_update" ? 2
    : st === "credit" || st === "hold" ? 3
    : st === "schedule" ? 4
    : st === "scheduled" ? 5
    : 1;
  return { labels, now };
}

/** The progress bar at the top of an order. Staff tap it for the Flow view. */
export function Steps({ order, stage, href }: { order: Pick<Order, "status" | "delivery_method">; stage: OrderStage | null; href?: string }) {
  const { labels, now } = orderSteps(order, stage);
  const off = order.status === "cancelled";
  const body = labels.map((l, i) => {
    const done = !off && i < now;
    const cur = !off && i === now;
    return (
      <div key={l} className={`st2${done ? " done" : ""}${cur ? " now" : ""}${done && i === now - 1 && now < labels.length ? " next-now" : ""}`}>
        <span className="d">{done ? <Check size={14} strokeWidth={3} /> : null}</span>
        <span>{l}</span>
      </div>
    );
  });
  const label = off ? "Cancelled" : now >= labels.length ? "All steps done" : `Step ${now + 1} of ${labels.length}: ${labels[now]}`;
  return href ? (
    <Link href={href} className={`steps2${off ? " off" : ""}`} aria-label={`${label}. Open the flow view`}>{body}</Link>
  ) : (
    <div className={`steps2${off ? " off" : ""}`} role="img" aria-label={label}>{body}</div>
  );
}
