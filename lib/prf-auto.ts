import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { priceRules, tellApprovers, tellRep, type PrLine, type PrRow } from "@/lib/price-requests";
import { computeScore, type Line, type Req } from "@/lib/prf-score";

/**
 * 0094: right after a rep sends a price request, score it and let the score rule approve it (85 or better, in the name
 * set on the rules page). Then the right people hear about it: the rep when it was approved, the approvers when it still waits.
 * Runs on the server with its own key, so nobody can send a made-up score. Returns false when the rule is off or can't run.
 */
export async function scoreRuleOn(): Promise<boolean> {
  if (!serviceReady()) return false;
  const rules = await priceRules(serviceClient()).catch(() => null);
  return Boolean(rules?.score_auto.enabled);
}

export async function scoreAndDecide(id: number): Promise<void> {
  const db = serviceClient();
  const load = async () => {
    const [{ data: r }, { data: ls }] = await Promise.all([
      db.from("price_requests").select("*").eq("id", id).maybeSingle(),
      db.from("price_request_lines").select("*").eq("request_id", id).order("id"),
    ]);
    return { r: r as (PrRow & Req) | null, lines: (ls ?? []) as (PrLine & Line)[] };
  };
  const { r, lines } = await load();
  if (!r) return;
  let status = r.status as string;
  try {
    const c = await computeScore(db, r, lines);
    const { data, error } = await db.rpc("price_request_score_auto", {
      p_request: id, p_score: c.score, p_grade: c.grade, p_parts: c.parts, p_metrics: c.metrics, p_ai: c.ai, p_model: c.model, p_cost: c.cost,
    });
    if (!error && typeof data === "string") status = data;
  } catch {
    // Scoring failed: the request just waits for a person, like before.
  }
  const fresh = await load();
  if (!fresh.r) return;
  if (status === "pending") await tellApprovers(db, fresh.r, fresh.lines).catch(() => null);
  else await tellRep(db, fresh.r, fresh.lines).catch(() => null);
}
