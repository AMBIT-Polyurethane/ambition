import { getWorkspace } from "@/lib/ops/server";
import { aiKeySet, loadAiSettings } from "@/lib/assistant/settings";
import { runAnswer, type HistoryRow } from "@/lib/assistant/run";
import { runTool, toolStatus, toolsFor, type AiCard } from "@/lib/ops/ai/tools";
import { opsSystem, opsWho } from "@/lib/ops/ai/prompt";

// AMBIT Intelligence in AMBIT-OPS (the pulsing atom button). Takes a question and the conversation so
// far, streams the answer back as lines of JSON:
//   {t:"status", text}  {t:"delta", text}  {t:"card", card}  {t:"done", body, sources, cards, left}  {t:"error", message}
// Conversations aren't saved; each question counts toward the person's daily Ask AMBIT limit and cost.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const s = await getWorkspace();
  if (!s) return json(401, { error: "Open your AMBIT-OPS workspace to use AMBIT Intelligence." });
  const { supabase, profile, ws } = s;

  let input: { text?: unknown; history?: unknown; page?: unknown };
  try {
    input = await request.json();
  } catch {
    return json(400, { error: "Bad request." });
  }
  const question = String(input.text ?? "").trim().slice(0, 2000);
  if (!question) return json(400, { error: "Say or type a question first." });
  const page = typeof input.page === "string" && /^\/[\w\-/]*$/.test(input.page) ? input.page.slice(0, 120) : null;
  const history: HistoryRow[] = (Array.isArray(input.history) ? input.history : [])
    .filter((h): h is { role: string; body: string } => !!h && typeof h === "object" && typeof (h as { body?: unknown }).body === "string")
    .slice(-12)
    .map((h) => ({ role: h.role === "user" ? "user" : "assistant", body: h.body.slice(0, 4000) }));

  const settings = await loadAiSettings(supabase);
  if (!settings) return json(503, { error: "AMBIT Intelligence isn't set up yet." });
  if (!aiKeySet()) return json(503, { error: "AMBIT Intelligence isn't connected yet (an AMBIT admin needs to add ANTHROPIC_API_KEY in Vercel)." });

  const { data: left, error: quotaErr } = await supabase.rpc("ai_take_question");
  if (quotaErr) return json(500, { error: "Couldn't check today's question limit." });
  if (typeof left === "number" && left < 0) {
    return json(429, { error: "You've reached today's limit for AMBIT Intelligence. It resets tomorrow." });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const cards: AiCard[] = [];
  const ctx = { supabase, profile, ws, today, cards };

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      try {
        const a = await runAnswer({
          supabase,
          profile,
          settings,
          history,
          question,
          emit,
          extra: {
            tools: toolsFor(ws),
            handle: async (name, args) => {
              const before = cards.length;
              const r = await runTool(ctx, name, args);
              for (const c of cards.slice(before)) emit({ t: "card", card: c });
              return r;
            },
            system: opsSystem(ws),
            who: opsWho(profile, ws, page),
            preSearch: false,
            status: toolStatus,
            maxTokens: 1500,
          },
        });
        await supabase.rpc("ai_add_cost", { p_cents: a.costCents });
        emit({ t: "done", body: a.body, sources: a.sources, cards, left });
      } catch (e) {
        console.error("AMBIT Intelligence failed", (e as { cause?: unknown })?.cause ?? e);
        emit({ t: "error", message: (e as Error)?.message || "Something went wrong. Try again in a moment." });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
