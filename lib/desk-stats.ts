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

