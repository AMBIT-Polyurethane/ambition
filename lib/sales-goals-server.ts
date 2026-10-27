import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBoard, type GoalBoard } from "@/lib/sales-goals";

/** The month's goals and sales (everyone for admins, yourself otherwise). Null if update 0028 hasn't been run. */
export async function goalBoard(db: SupabaseClient, month?: string | null, person?: string | null): Promise<GoalBoard | null> {
  const { data, error } = await db.rpc("sales_goal_board", { p_month: month ?? null, p_person: person ?? null });
  if (error) return null;
  return normalizeBoard(data);
}
