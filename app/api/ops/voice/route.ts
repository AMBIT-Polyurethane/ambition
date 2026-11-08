import { getWorkspace } from "@/lib/ops/server";
import { ALL_FILLERS } from "@/lib/ops/ai/fillers";
import { forVoice, sayOk, serverVoiceOn } from "@/lib/ops/ai/voice-server";

// AMBIT Intelligence's spoken voice: GET /api/ops/voice?t=<words>&s=<signature> streams back MP3 from
// ElevenLabs (lib/ops/ai/voice-server.ts says how it's set up). Only signed words or the fixed "one sec"
// phrases are spoken. Any problem answers with an error and the app falls back to the device's voice.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const s = await getWorkspace();
  if (!s) return fail(401, "Sign in first.");
  if (!serverVoiceOn()) return fail(404, "No voice is set up.");
  const url = new URL(request.url);
  const text = (url.searchParams.get("t") ?? "").trim();
  if (!text || text.length > 900) return fail(400, "Nothing to say.");
  if (!ALL_FILLERS.has(text) && !sayOk(text, url.searchParams.get("s"))) return fail(403, "Not allowed.");

  const voice = process.env.ELEVENLABS_VOICE_ID!.trim();
  const model = process.env.ELEVENLABS_MODEL?.trim() || "eleven_turbo_v2_5";
  let r: Response;
  try {
    r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!.trim(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: forVoice(text),
        model_id: model,
        voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.2, use_speaker_boost: true },
      }),
    });
  } catch (e) {
    console.error("AMBIT voice: couldn't reach ElevenLabs", e);
    return fail(502, "The voice service didn't answer.");
  }
  if (!r.ok || !r.body) {
    console.error("AMBIT voice: ElevenLabs said", r.status, (await r.text().catch(() => "")).slice(0, 400));
    return fail(502, "The voice service said no.");
  }
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" } });
}
