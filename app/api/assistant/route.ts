import { getSession } from "@/lib/session";
import { aiKeySet, canUseAssistant, loadAiSettings } from "@/lib/assistant/settings";
import { runAnswer, type HistoryRow } from "@/lib/assistant/run";

// Ask AMBIT: takes a question, streams the answer back as lines of JSON:
//   {t:"thread", id, left}  {t:"status", text}  {t:"delta", text}  {t:"done", message}  {t:"error", message}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const s = await getSession();
  if (!s?.profile || s.profile.status !== "active") return json(401, { error: "Sign in to use Ask AMBIT." });
  const { supabase, profile } = s;

  let input: { thread?: unknown; text?: unknown };
  try {
    input = await request.json();
  } catch {
    return json(400, { error: "Bad request." });
  }
  const question = String(input.text ?? "").trim().slice(0, 4000);
  if (!question) return json(400, { error: "Type a question first." });

  const settings = await loadAiSettings(supabase);
  if (!settings) return json(503, { error: "Ask AMBIT isn't set up yet (an admin needs to run supabase/migrations/0020_assistant.sql)." });
  if (!canUseAssistant(profile, settings)) return json(403, { error: "Ask AMBIT isn't open to contractors yet." });
  if (!aiKeySet()) return json(503, { error: "Ask AMBIT isn't connected yet: an admin needs to add ANTHROPIC_API_KEY in Vercel." });

  // The conversation: an existing one of theirs, or a new one.
  let threadId = typeof input.thread === "string" && /^[0-9a-f-]{36}$/i.test(input.thread) ? input.thread : null;
  let history: HistoryRow[] = [];
  if (threadId) {
    const { data: t } = await supabase.from("ai_threads").select("id").eq("id", threadId).eq("user_id", profile.id).maybeSingle();
    if (!t) threadId = null;
    else {
      const { data: rows } = await supabase.from("ai_messages").select("role, body, author_name").eq("thread_id", threadId).order("id");
      history = (rows ?? []) as HistoryRow[];
    }
  }

  const { data: left, error: quotaErr } = await supabase.rpc("ai_take_question");
  if (quotaErr) return json(500, { error: "Couldn't check today's question limit." });
  if (typeof left === "number" && left < 0) {
    return json(429, { error: "You've reached today's question limit for Ask AMBIT. It resets tomorrow." });
  }

  if (!threadId) {
    const title = question.replace(/\s+/g, " ").slice(0, 80);
    const { data: t, error } = await supabase.from("ai_threads").insert({ user_id: profile.id, title }).select("id").single();
    if (error || !t) return json(500, { error: "Couldn't start the conversation." });
    threadId = t.id as string;
  }
  await supabase.from("ai_messages").insert({ thread_id: threadId, user_id: profile.id, role: "user", body: question });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      emit({ t: "thread", id: threadId, left });
      try {
        const a = await runAnswer({ supabase, profile, settings, history, question, emit });
        const { data: saved } = await supabase
          .from("ai_messages")
          .insert({
            thread_id: threadId,
            user_id: profile.id,
            role: "assistant",
            body: a.body,
            sources: a.sources,
            no_source: a.noSource,
            model: a.model,
            input_tokens: a.inputTokens,
            output_tokens: a.outputTokens,
            searches: a.searches,
            cost_cents: a.costCents,
          })
          .select("id, created_at")
          .single();
        await Promise.all([
          supabase.rpc("ai_add_cost", { p_cents: a.costCents }),
          supabase.from("ai_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId),
        ]);
        emit({
          t: "done",
          message: { id: saved?.id ?? null, role: "assistant", body: a.body, sources: a.sources, no_source: a.noSource, created_at: saved?.created_at ?? new Date().toISOString() },
        });
      } catch (e) {
        console.error("Ask AMBIT failed", (e as { cause?: unknown })?.cause ?? e);
        emit({ t: "error", message: (e as Error)?.message || "Something went wrong while answering." });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
