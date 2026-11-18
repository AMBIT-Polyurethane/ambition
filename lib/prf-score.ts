import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claudeReady, costCents, fillForm } from "@/lib/ai/claude";
import { loadAiSettings } from "@/lib/assistant/settings";
import { creditFor } from "@/lib/credit";
import type { PrLine, PrRow } from "@/lib/price-requests";

// 0088: how much a price request is worth to AMBIT. The app works out four sub-scores from every price request in the
// last 90 days (price, volume, customer, details); the AI reads the same numbers plus the requests themselves and
// gives the final score, a one-line verdict, strengths, concerns and what to do.

export type Line = PrLine & { basis?: string | null; quote_type?: string | null };
export type Req = PrRow & { customer_kind?: string | null; customer?: Record<string, string> | null; product_lines?: string[] | null };

export type LineMetric = {
  id: number; name: string; unit: string | null; asked: number; list: number | null; floor: number | null; underList: number | null; belowFloor: boolean;
  peers: number; medAsked: number | null; medApproved: number | null; lowAsked: number | null; highAsked: number | null;
  /** 0-100: how many of the last 90 days' asks for the same item were at or below this one (higher = better for AMBIT). */
  rank: number | null;
  volume: string | null;
};
export type ScoreMetrics = {
  lines: LineMetric[];
  customer: {
    kind: string | null; type: string | null; rigs: number | null; monthlySets: number | null; currentMfr: string | null; wantsCredit: boolean; creditRequested: number | null;
    sales12: number | null; orders12: number | null; lastOrder: string | null; pastDue: number | null; available: number | null;
  };
  rep: { name: string | null; requests90: number; approved90: number; denied90: number };
  context: { requests90: number; avgUnderList: number | null };
};
export type ScoreParts = { price: number; volume: number; customer: number; details: number; total: number };
export type ScoreAi = { headline: string; strengths: string[]; concerns: string[]; recommendation: "approve" | "counter" | "deny"; counter: string; est_monthly: number | null };
export type PrScore = { score: number; grade: string; parts: ScoreParts; metrics: ScoreMetrics; ai: ScoreAi | null; scored_at: string; scored_by_name: string | null; model: string | null };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const num = (s: string | null | undefined) => {
  const m = /(\d+(?:\.\d+)?)/.exec(String(s ?? "").replace(/,/g, ""));
  return m ? Number(m[1]) : null;
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const keyOf = (l: Line) => (l.quote_type ? `t:${l.quote_type.toLowerCase()}` : l.product_id ? `p:${l.product_id}:${l.basis ?? "unit"}` : `s:${l.sku}:${l.basis ?? "unit"}`);
export const gradeOf = (n: number) => (n >= 85 ? "A" : n >= 70 ? "B" : n >= 55 ? "C" : n >= 40 ? "D" : "F");

/** Every number the score is built from. */
export async function scoreMetrics(db: SupabaseClient, req: Req, lines: Line[]): Promise<{ metrics: ScoreMetrics; peers: { r: Req; lines: Line[] }[] }> {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: reqRows } = await db.from("price_requests").select("*").gte("created_at", since).neq("id", req.id).neq("status", "withdrawn").order("created_at", { ascending: false }).limit(400);
  const others = (reqRows ?? []) as Req[];
  const ids = others.map((r) => r.id);
  const peerLines: Line[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db.from("price_request_lines").select("*").in("request_id", ids.slice(i, i + 150));
    peerLines.push(...((data ?? []) as Line[]));
  }
  const byKey = new Map<string, Line[]>();
  for (const l of peerLines) byKey.set(keyOf(l), [...(byKey.get(keyOf(l)) ?? []), l]);
  const pids = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x))];
  const { data: floorRows } = pids.length ? await db.from("price_floors").select("product_id, floor").in("product_id", pids) : { data: [] };
  const floorOf = new Map(((floorRows ?? []) as { product_id: string; floor: number }[]).map((f) => [f.product_id, Number(f.floor)]));

  const lm: LineMetric[] = lines.map((l) => {
    const asked = Number(l.requested_price);
    const list = l.list_price === null ? null : Number(l.list_price);
    const floor = l.product_id && (l.basis ?? "unit") === "unit" ? floorOf.get(l.product_id) ?? null : null;
    const peers = byKey.get(keyOf(l)) ?? [];
    const asks = peers.map((p) => Number(p.requested_price)).filter((n) => n > 0);
    const apps = peers.filter((p) => p.status === "approved" && p.approved_price !== null).map((p) => Number(p.approved_price));
    return {
      id: l.id, name: l.name, unit: l.unit, asked, list, floor,
      underList: list ? Math.round((1 - asked / list) * 1000) / 10 : null,
      belowFloor: floor !== null && asked < floor,
      peers: asks.length, medAsked: median(asks), medApproved: median(apps),
      lowAsked: asks.length ? Math.min(...asks) : null, highAsked: asks.length ? Math.max(...asks) : null,
      rank: asks.length >= 2 ? clamp((asks.filter((a) => a <= asked).length / asks.length) * 100) : null,
      volume: l.volume,
    };
  });

  const cu = req.customer ?? {};
  let sales12: number | null = null, orders12: number | null = null, lastOrder: string | null = null, pastDue: number | null = null, available: number | null = null;
  if (req.company_id) {
    const yr = new Date(Date.now() - 365 * 86400_000).toISOString();
    const [{ data: ords }, credit] = await Promise.all([
      db.from("orders").select("est_subtotal, created_at").eq("company_id", req.company_id).neq("status", "cancelled").gte("created_at", yr).limit(2000),
      creditFor(db, req.company_id).catch(() => null),
    ]);
    const os = (ords ?? []) as { est_subtotal: number | null; created_at: string }[];
    sales12 = Math.round(os.reduce((t, o) => t + Number(o.est_subtotal ?? 0), 0));
    orders12 = os.length;
    lastOrder = os.map((o) => o.created_at).sort().pop()?.slice(0, 10) ?? null;
    pastDue = credit ? Number(credit.past_due ?? 0) : null;
    available = credit && credit.available !== null ? Number(credit.available) : null;
  }
  const mine = others.filter((r) => r.created_by && r.created_by === req.created_by);
  const allUnder = peerLines.filter((l) => l.list_price && Number(l.list_price) > 0).map((l) => (1 - Number(l.requested_price) / Number(l.list_price)) * 100);
  return {
    metrics: {
      lines: lm,
      customer: {
        kind: req.customer_kind ?? (req.company_id ? "existing" : "new"),
        type: cu.customer_type || null,
        rigs: num(cu.rigs),
        monthlySets: num(cu.monthly_sets),
        currentMfr: cu.current_mfr || null,
        wantsCredit: /^yes/i.test(cu.wants_credit ?? ""),
        creditRequested: num(cu.credit_requested),
        sales12, orders12, lastOrder, pastDue, available,
      },
      rep: { name: req.rep_name, requests90: mine.length, approved90: mine.filter((r) => r.status === "approved" || r.status === "partly").length, denied90: mine.filter((r) => r.status === "denied").length },
      context: { requests90: others.length, avgUnderList: allUnder.length ? Math.round((allUnder.reduce((a, b) => a + b, 0) / allUnder.length) * 10) / 10 : null },
    },
    peers: others.map((r) => ({ r, lines: peerLines.filter((l) => l.request_id === r.id) })),
  };
}

/** The app's own four sub-scores (0-100) and the weighted total. */
export function scoreParts(m: ScoreMetrics, note: string | null): ScoreParts {
  const lineScores = m.lines.map((l) => {
    const listS = l.underList !== null ? clamp(100 - Math.max(0, l.underList) * 4) : null;
    let s = l.rank !== null && listS !== null ? 0.6 * l.rank + 0.4 * listS : l.rank ?? listS ?? 50;
    if (l.belowFloor) s = Math.min(s, 15);
    return s;
  });
  const price = lineScores.length ? clamp(lineScores.reduce((a, b) => a + b, 0) / lineScores.length) : 50;
  const sets = m.customer.monthlySets;
  let volume = sets === null ? 35 : sets <= 0 ? 15 : sets < 1 ? 25 : sets <= 2 ? 45 : sets <= 5 ? 65 : sets <= 10 ? 82 : sets <= 20 ? 92 : 98;
  if ((m.customer.rigs ?? 0) >= 3) volume = clamp(volume + 5);
  const c = m.customer;
  let customer = c.kind === "existing" && c.sales12 !== null
    ? 55 + Math.min(30, (c.sales12 / 250_000) * 30) + ((c.orders12 ?? 0) >= 6 ? 10 : (c.orders12 ?? 0) >= 2 ? 5 : 0)
    : c.kind === "previous" ? 45 : c.wantsCredit && (c.creditRequested ?? 0) > 25_000 ? 40 : 50;
  if ((c.pastDue ?? 0) > 0) customer -= 25;
  if (c.available !== null && c.available < 0) customer -= 10;
  customer = clamp(customer);
  const n = (note ?? "").trim().length;
  const withVol = m.lines.length ? m.lines.filter((l) => (l.volume ?? "").trim()).length / m.lines.length : 0;
  const details = clamp((n >= 120 ? 40 : n >= 40 ? 25 : 10) + (c.currentMfr && !/^none$/i.test(c.currentMfr) ? 20 : 0) + withVol * 25 + (sets !== null ? 15 : 0));
  return { price, volume, customer, details, total: clamp(0.4 * price + 0.3 * volume + 0.15 * customer + 0.15 * details) };
}

const SYSTEM = `You score price requests for AMBIT Polyurethane, a spray foam and insulation distributor (spray foam sold per lb or by the drum set; a "set" is one A-side ISO drum plus one B-side resin drum, roughly 1,000 lb together; fiberglass per sq ft; coatings and intumescents per unit). A sales rep asks for special pricing for a customer; a manager approves, counters or denies it.
Score the request 0-100 for its overall value to AMBIT: how strong the asked prices are compared with list price, the floor and the other requests from the last 90 days (40%), how much volume the customer will buy (30%), the customer's quality and history with AMBIT (15%), and how complete and well-justified the request is (15%).
You get the app's own sub-scores for those four parts and their weighted total. Stay within 10 points of that total unless the requests themselves show a clear reason, and if you move it, say why in a concern or strength. Be concrete: cite prices, percentages and set counts. Never invent numbers you weren't given. Keep each point under 20 words.`;

const FORM = {
  name: "score_price_request",
  description: "Record the price request's quality score and why.",
  schema: {
    type: "object",
    properties: {
      score: { type: "integer", description: "0-100 overall value to AMBIT" },
      headline: { type: "string", description: "One short sentence verdict" },
      strengths: { type: "array", items: { type: "string" }, description: "Up to 4" },
      concerns: { type: "array", items: { type: "string" }, description: "Up to 4" },
      recommendation: { type: "string", enum: ["approve", "counter", "deny"] },
      counter: { type: "string", description: "If counter: the prices to offer instead, one short sentence. Else empty." },
      est_monthly: { type: "number", description: "Estimated monthly revenue to AMBIT in dollars at the asked prices, or 0 if it can't be estimated" },
    },
    required: ["score", "headline", "strengths", "concerns", "recommendation", "counter", "est_monthly"],
  } as Record<string, unknown>,
};

/** Score one request (the app's numbers, then the AI) and save it. Needs a price approver's session. */
export async function scorePriceRequest(db: SupabaseClient, req: Req, lines: Line[]): Promise<{ ok: true; score: PrScore } | { ok: false; error: string }> {
  const { metrics, peers } = await scoreMetrics(db, req, lines);
  const parts = scoreParts(metrics, req.note);
  let ai: ScoreAi | null = null;
  let score = parts.total;
  let model: string | null = null;
  let cost = 0;
  if (claudeReady()) {
    const settings = await loadAiSettings(db);
    model = settings?.model === "claude-opus-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";
    const cu = req.customer ?? {};
    const recent = peers.slice(0, 80).map(({ r, lines: ls }) => ({
      company: r.company_name, kind: r.customer_kind ?? null, type: r.customer?.customer_type ?? null, sets_month: r.customer?.monthly_sets ?? null, status: r.status,
      lines: ls.slice(0, 6).map((l) => ({ item: l.name, per: l.unit, asked: Number(l.requested_price), list: l.list_price === null ? null : Number(l.list_price), approved: l.approved_price === null ? null : Number(l.approved_price), status: l.status })),
    }));
    const ask = JSON.stringify({
      this_request: {
        company: req.company_name, rep: req.rep_name, kind: req.customer_kind ?? null, customer_type: cu.customer_type ?? null, rigs: cu.rigs ?? null, sets_per_month: cu.monthly_sets ?? null,
        buying_from_now: cu.current_mfr ?? null, wants_credit: cu.wants_credit ?? null, credit_requested: cu.credit_requested ?? null, product_lines: req.product_lines ?? [], rep_note: req.note,
        lines: lines.map((l) => ({ item: l.name, per: l.unit, asked: Number(l.requested_price), list: l.list_price === null ? null : Number(l.list_price), volume: l.volume })),
      },
      app_numbers: { metrics, sub_scores: parts },
      last_90_days: recent,
    });
    try {
      const { data, usage } = await fillForm<{ score: number; headline: string; strengths: string[]; concerns: string[]; recommendation: string; counter: string; est_monthly: number | null }>({
        model, maxTokens: 1500, system: SYSTEM, content: ask, ...FORM,
      });
      cost = costCents(model, usage);
      score = Number.isFinite(Number(data.score)) ? clamp(Number(data.score)) : parts.total;
      ai = {
        headline: String(data.headline ?? "").slice(0, 200),
        strengths: (data.strengths ?? []).slice(0, 4).map((s) => String(s).slice(0, 200)),
        concerns: (data.concerns ?? []).slice(0, 4).map((s) => String(s).slice(0, 200)),
        recommendation: data.recommendation === "deny" || data.recommendation === "counter" ? data.recommendation : "approve",
        counter: String(data.counter ?? "").slice(0, 300),
        est_monthly: Number(data.est_monthly) > 0 ? Math.round(Number(data.est_monthly)) : null,
      };
    } catch {
      ai = null; // the app's own score still shows
    }
  }
  const grade = gradeOf(score);
  const { error } = await db.rpc("price_request_score_save", { p_request: req.id, p_score: score, p_grade: grade, p_parts: parts, p_metrics: metrics, p_ai: ai, p_model: ai ? model : null, p_cost: cost });
  if (error) return { ok: false, error: /price_request_score_save|function|schema cache/i.test(error.message) && !/approvers|not found/i.test(error.message) ? "The quality score needs database update 0088 first (Supabase > SQL Editor)." : error.message };
  return { ok: true, score: { score, grade, parts, metrics, ai, scored_at: new Date().toISOString(), scored_by_name: null, model: ai ? model : null } };
}

/** The saved score, or null. */
export async function savedScore(db: SupabaseClient, id: number): Promise<PrScore | null> {
  const { data, error } = await db.from("price_request_scores").select("score, grade, parts, metrics, ai, scored_at, scored_by_name, model").eq("request_id", id).maybeSingle<PrScore>();
  return error || !data ? null : data;
}
