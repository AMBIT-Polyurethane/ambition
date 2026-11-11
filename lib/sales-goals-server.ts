import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBoard, type GoalBoard, type GoalPerson } from "@/lib/sales-goals";
import { addDays, centralStart } from "@/lib/order-desk";

/** The month's goals and sales (everyone for admins, yourself otherwise). Null if update 0028 hasn't been run. */
export async function goalBoard(db: SupabaseClient, month?: string | null, person?: string | null): Promise<GoalBoard | null> {
  const { data, error } = await db.rpc("sales_goal_board", { p_month: month ?? null, p_person: person ?? null });
  if (error) return null;
  return normalizeBoard(data);
}

/** One sale on a person's list: an order credited to them. */
export type SaleRow = {
  id: string;
  order_no: number;
  company_name: string;
  placed_at: string;
  branch_id: string | null;
  total: number; // the lines that have their invoice price
  waiting: boolean; // a line still waits for the order desk to enter its price
};

const PAGE = 1000;
const MAX_PAGES = 10;

/**
 * Everything credited to a person between two Central-time days (either may be open), newest first. Same rules as
 * the goal board: a sales rep gets their customers' orders, everyone else every order from their location; cancelled
 * orders don't count; an order counts on the day it was placed, at the invoice prices entered so far.
 */
export async function personSales(
  db: SupabaseClient,
  who: Pick<GoalPerson, "id" | "basis" | "branch_id">,
  from: string | null,
  to: string | null,
): Promise<{ rows: SaleRow[]; capped: boolean; error: string | null }> {
  if (who.basis === "branch" && !who.branch_id) return { rows: [], capped: false, error: null };
  const rows: SaleRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = db
      .from("orders")
      .select("id, order_no, company_name, created_at, branch_id, order_items(line_total)")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .order("order_no", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    q = who.basis === "branch" ? q.eq("branch_id", who.branch_id!) : q.eq("sales_rep_id", who.id);
    if (from) q = q.gte("created_at", centralStart(from));
    if (to) q = q.lt("created_at", centralStart(addDays(to, 1)));
    const { data, error } = await q;
    if (error) return { rows, capped: false, error: error.message };
    const got = (data ?? []) as {
      id: string;
      order_no: number;
      company_name: string;
      created_at: string;
      branch_id: string | null;
      order_items: { line_total: number | string | null }[] | null;
    }[];
    for (const o of got) {
      const lines = o.order_items ?? [];
      if (!lines.length) continue; // the goal board only counts orders with lines
      rows.push({
        id: o.id,
        order_no: o.order_no,
        company_name: o.company_name,
        placed_at: o.created_at,
        branch_id: o.branch_id,
        total: lines.reduce((a, l) => a + (l.line_total == null ? 0 : Number(l.line_total)), 0),
        waiting: lines.some((l) => l.line_total == null),
      });
    }
    if (got.length < PAGE) return { rows, capped: false, error: null };
  }
  return { rows, capped: true, error: null };
}
