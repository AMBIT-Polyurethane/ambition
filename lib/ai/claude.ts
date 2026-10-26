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
