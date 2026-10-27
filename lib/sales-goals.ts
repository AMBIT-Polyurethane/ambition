// Sales goals (0028): the 8 groups every product category belongs to, and the monthly progress board.

export const GOAL_GROUPS = [
  { key: "foam", label: "Foam Products", short: "Foam" },
  { key: "fiberglass", label: "Fiberglass", short: "Fiberglass" },
  { key: "ppe", label: "Personal Protective Equipment", short: "PPE" },
  { key: "roof", label: "Roof Coatings & Sealants", short: "Roof coatings" },
  { key: "guns", label: "Gun & Parts", short: "Guns & parts" },
  { key: "intumescent", label: "Intumescent Coatings", short: "Intumescents" },
  { key: "sealants", label: "Sealants / Adhesives", short: "Sealants" },
  { key: "supplies", label: "Tools, Accessories & Supplies", short: "Tools & supplies" },
] as const;

export type GoalKey = (typeof GOAL_GROUPS)[number]["key"];
export const GOAL_KEYS = GOAL_GROUPS.map((g) => g.key) as GoalKey[];
export const goalLabel = (k: string | null | undefined) => GOAL_GROUPS.find((g) => g.key === k)?.label ?? "Tools, Accessories & Supplies";

export type GoalPerson = {
  id: string;
  name: string;
  job_role: string | null;
  branch_id: string | null;
  basis: "rep" | "branch"; // rep = their customers' orders; branch = everything from their location
  goals: Partial<Record<GoalKey, number>>;
  sold: Partial<Record<GoalKey, number>>;
  orders: number;
  waiting: number; // orders with a line still waiting for its price
};
export type GoalBoard = { month: string; people: GoalPerson[] };

export const sum = (r: Partial<Record<string, number>>) => Object.values(r).reduce<number>((a, v) => a + Number(v ?? 0), 0);

/** Where the month is (0..1), in Central time: day 15 of 30 → 0.5. A past month is 1. */
export function monthGone(month: string, today: string): number {
  if (today.slice(0, 7) > month.slice(0, 7)) return 1;
  if (today.slice(0, 7) < month.slice(0, 7)) return 0;
  const d = new Date(`${today}T12:00:00Z`);
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() / days;
}

export function normalizeBoard(raw: unknown): GoalBoard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { month?: string; people?: GoalPerson[] };
  const num = (o: Record<string, unknown> | null | undefined) =>
    Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, Number(v ?? 0)])) as Partial<Record<GoalKey, number>>;
  return {
    month: String(r.month ?? ""),
    people: (r.people ?? []).map((p) => ({ ...p, goals: num(p.goals), sold: num(p.sold), orders: Number(p.orders ?? 0), waiting: Number(p.waiting ?? 0) })),
  };
}
