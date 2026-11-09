import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { modelInfo } from "@/lib/assistant/config";
import { shrinkImage } from "@/lib/image-shrink";

// Shared pieces for the app's Claude features (Ask AMBIT, order intake, complaint reports).

export const claudeReady = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

export function claude(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 100_000 });
}

type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

/** What a call cost, in cents (estimate from the published prices). */
export function costCents(modelId: string, u: UsageLike): number {
  const m = modelInfo(modelId);
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  const c = ((input * m.inPerM + (u.output_tokens ?? 0) * m.outPerM) / 1_000_000) * 100 + (u.server_tool_use?.web_search_requests ?? 0);
  return Math.round(c * 1000) / 1000;
}

/** Photos from the "photos" bucket, ready to show Claude (made smaller first). Paths must be the person's own. */
export async function photoBlocks(supabase: SupabaseClient, paths: string[], ownerId: string): Promise<Anthropic.Messages.ImageBlockParam[]> {
  const mine = paths.filter((p) => typeof p === "string" && p.startsWith(`${ownerId}/`) && !p.includes("..")).slice(0, 4);
  const out: Anthropic.Messages.ImageBlockParam[] = [];
  for (const p of mine) {
    const { data } = await supabase.storage.from("photos").download(p);
    if (!data) continue;
    const small = await shrinkImage(await data.arrayBuffer(), 1568, 80);
    if (!small) continue;
    out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.body.toString("base64") } });
  }
  return out;
}

export function friendlyClaudeError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const msg = String((e as { message?: string })?.message ?? e);
  if (status === 401 || /authentication|api[_ -]?key/i.test(msg)) return "The app's connection to Claude isn't working (an admin needs to check ANTHROPIC_API_KEY in Vercel).";
  if (/credit balance|billing/i.test(msg)) return "The app's Claude account is out of credit. An admin needs to add credit in the Anthropic Console (Billing).";
  if (status === 429 || status === 529 || /overloaded|rate limit/i.test(msg)) return "Claude is busy right now. Try again in a minute.";
  return "Something went wrong reading that. Try again in a moment.";
}

/** Every object in a JSON schema closed to extra keys (structured outputs need that). */
function closed(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closed);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, closed(pv)])) : closed(v);
  if (out.type === "object" && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

/**
 * Asks Claude to fill in a form (JSON that fits `schema`). Uses structured outputs; if the model doesn't
 * accept that request, offers the form as a tool instead and asks Claude to use it. (Newer models don't
 * allow forcing a particular tool, so this never does.)
 */
export async function fillForm<T>(opts: {
  model: string;
  maxTokens: number;
  system: string | Anthropic.Messages.TextBlockParam[];
  content: string | Anthropic.Messages.ContentBlockParam[];
  name: string;
  description: string;
  schema: Record<string, unknown>;
}): Promise<{ data: T; usage: Anthropic.Messages.Usage }> {
  const api = claude();
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: opts.content }];
  try {
    const res = await api.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages,
      output_config: { format: { type: "json_schema", schema: closed(opts.schema) as Record<string, unknown> } },
    });
    if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (too long).");
    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { data: JSON.parse(text) as T, usage: res.usage };
  } catch (e) {
    if ((e as { status?: number })?.status !== 400) throw e;
    console.warn(`structured output not accepted for ${opts.name}; using a tool instead:`, String((e as Error)?.message ?? e).slice(0, 300));
  }
  const sys: Anthropic.Messages.TextBlockParam[] = [
    ...(typeof opts.system === "string" ? [{ type: "text" as const, text: opts.system }] : opts.system),
    { type: "text", text: `Give your answer only by calling the ${opts.name} tool, once.` },
  ];
  const res = await api.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: sys,
    messages,
    tools: [{ name: opts.name, description: opts.description, input_schema: opts.schema as Anthropic.Messages.Tool.InputSchema }],
    tool_choice: { type: "auto" },
  });
  const use = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === opts.name);
  if (!use) throw new Error(`Claude didn't fill in ${opts.name}.`);
  return { data: use.input as T, usage: res.usage };
}


/** Claude stopped or refused: `kind` says which, so the screen can explain it. */
export class ClaudeStop extends Error {
  constructor(public kind: "refusal" | "cut_off" | "oversized" | "empty", message: string, public fit?: { w: number; h: number }) {
    super(message);
  }
}

/**
 * Like fillForm, for long, careful answers (a plan sheet's geometry): streamed (so a long answer isn't cut
 * off by the request timing out), with a large token limit and an effort level. Images are never shrunk by
 * the API (the coordinates would shift): an image that's too big comes back as ClaudeStop "oversized" with
 * the largest size that fits, when the API says it.
 */
export async function streamForm<T>(opts: {
  model: string;
  maxTokens: number;
  system: string | Anthropic.Messages.TextBlockParam[];
  content: Anthropic.Messages.ContentBlockParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Ask the API to refuse (not shrink) a too-big image. Not needed for a picture every model takes as it is. */
  guardImages?: boolean;
}): Promise<{ data: T; usage: Anthropic.Messages.Usage; ms: number }> {
  const api = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 14 * 60_000 });
  const t0 = Date.now();
  // What this model accepts is learned as we go: a request it turns down is asked again without that part.
  const opt = { effort: opts.effort ?? null, guard: opts.guardImages !== false, form: "schema" as "schema" | "tool" };
  const call = async () => {
    const content = opts.content.map((b) => (b.type === "image" && opt.guard ? { ...b, transformations: { oversized_image: "error" as const } } : b));
    const stream = api.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system:
        opt.form === "tool"
          ? [...(typeof opts.system === "string" ? [{ type: "text" as const, text: opts.system }] : opts.system), { type: "text" as const, text: "Give your answer only by calling the answer tool, once." }]
          : opts.system,
      messages: [{ role: "user", content }],
      ...(opt.form === "tool" ? { tools: [{ name: "answer", description: "Your complete answer.", input_schema: opts.schema as Anthropic.Messages.Tool.InputSchema }], tool_choice: { type: "auto" as const } } : {}),
      output_config: { ...(opt.form === "schema" ? { format: { type: "json_schema" as const, schema: closed(opts.schema) as Record<string, unknown> } } : {}), ...(opt.effort ? { effort: opt.effort } : {}) },
    });
    return stream.finalMessage();
  };
  let res: Anthropic.Messages.Message | null = null;
  for (let attempt = 0; attempt < 4 && !res; attempt++) {
    try {
      res = await call();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      const msg = String((e as Error)?.message ?? e);
      if (status !== 400) throw e;
      if (opt.guard && /transformations|oversized_image/i.test(msg) && /not permitted|unknown|unexpected|unrecognized|not allowed|extra input/i.test(msg)) {
        // This model can't refuse instead of shrinking: draw the picture at a size every model takes as it is.
        throw new ClaudeStop("oversized", "The plan picture was bigger than the AI takes.");
      } else if (/image|dimension|pixel|oversiz/i.test(msg)) {
        // "... 2400x1600 ... largest dimensions that fit: 1568x1045": the last pair is what fits.
        const pairs = [...msg.matchAll(/(\d{3,5})\s*[x×]\s*(\d{3,5})/g)].map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
        throw new ClaudeStop("oversized", "The plan picture was bigger than the AI takes.", pairs.length ? pairs[pairs.length - 1] : undefined);
      } else if (/effort/i.test(msg) && opt.effort) opt.effort = null;
      else if (/schema|output_config|json|structured|format/i.test(msg) && opt.form === "schema") {
        console.warn("structured output not accepted; using a tool instead:", msg.slice(0, 300));
        opt.form = "tool";
      } else throw e;
    }
  }
  if (!res) throw new ClaudeStop("empty", "The AI didn't answer. Try again.");
  if (res.stop_reason === "refusal") throw new ClaudeStop("refusal", "The AI declined to read this sheet.");
  if (res.stop_reason === "max_tokens") throw new ClaudeStop("cut_off", "The AI's answer was cut off (too long for one sheet). Try splitting the sheet or reading it again.");
  if (opt.form === "tool") {
    const use = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === "answer");
    if (!use) throw new ClaudeStop("empty", "The AI didn't answer. Try again.");
    return { data: use.input as T, usage: res.usage, ms: Date.now() - t0 };
  }
  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new ClaudeStop("empty", "The AI didn't answer. Try again.");
  return { data: JSON.parse(text) as T, usage: res.usage, ms: Date.now() - t0 };
}
