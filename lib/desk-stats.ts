import type { OrderStage } from "@/lib/types";

// Shared by the Order Desk page (server) and its dashboard (client).

export type StepKey = "customer" | "po" | "credit" | "schedule";
type Agg = { n: number; avg: number | null; median: number | null };

export type DeskStats = {
  first: string;
  since: string;
  today: string;
  bucket: "day" | "week";
  open: Partial<Record<OrderStage, number>>;
  by_branch: { branch: string; stage: OrderStage; n: number }[];
  placed: number;
  completed: number;
  cancelled: number;
  series: { d: string; n: number }[] | null;
  steps: Partial<Record<StepKey, Agg>>;
  cycle: Agg | null;
  stuck: number;
  waiting: { id: string; order_no: number; company: string; stage: OrderStage; branch: string | null; since: string; hours: number; late: boolean; scheduled_for: string | null }[];
};

export const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "year", label: "This year", days: 0 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];


/** 0.6 -> "35 min", 5.2 -> "5.2 hrs", 70 -> "2.9 days" */
export function duration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return "–";
  const h = Number(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} hrs`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}
