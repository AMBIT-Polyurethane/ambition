import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";

// AMBIT Intelligence's spoken voice (ElevenLabs). Set in Vercel -> Settings -> Environment Variables:
//   ELEVENLABS_API_KEY   the key from ElevenLabs (Profile -> API keys)
//   ELEVENLABS_VOICE_ID  the voice to use (Jeremiah's clone, or any ElevenLabs voice until it's ready)
//   ELEVENLABS_MODEL     optional, default eleven_turbo_v2_5 (fast and natural)
//   AMBIT_VOICE_LABEL    optional, shown to people, default "an AI copy of Jeremiah Bryant's voice"
// Without the key and voice, the device's own voice is used.
//
// The voice only says words the server wrote: AMBIT Intelligence's spoken answers, the guide's lines and
// the fixed "one sec" phrases. Each is signed here; app/api/ops/voice refuses anything else, so nobody can
// make the cloned voice say whatever they type.

const secret = () =>
  process.env.VOICE_SIGNING_SECRET?.trim() ||
  createHash("sha256").update(`ambit-voice|${process.env.ELEVENLABS_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "local"}`).digest("hex");

export function signSay(text: string): string {
  return createHmac("sha256", secret()).update(text).digest("base64url").slice(0, 24);
}

export function sayOk(text: string, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const a = Buffer.from(signSay(text));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const serverVoiceOn = () => !!process.env.ELEVENLABS_API_KEY?.trim() && !!process.env.ELEVENLABS_VOICE_ID?.trim();

export const voiceLabel = () => process.env.AMBIT_VOICE_LABEL?.trim() || "an AI copy of Jeremiah Bryant's voice";

/** Words written for reading, turned into words a voice says right (AMBIT isn't A-M-B-I-T). */
export function forVoice(text: string): string {
  return text
    .replace(/⟦[\d,\s]+⟧/g, "")
    .replace(/\bAMBI-SEAL\b/gi, "Ambi-Seal")
    .replace(/\bAMBI-TITE\b/gi, "Ambi-Tight")
    .replace(/\bAMBI-JACK\b/gi, "Ambi-Jack")
    .replace(/\bAMBI-ROOF\b/gi, "Ambi-Roof")
    .replace(/\bAMBIT\b/g, "Ambit")
    .replace(/\bOPS\b/g, "Ops")
    .replace(/\bISO\b/g, "eye-so")
    .replace(/\bbf\/set\b/gi, "board feet per set")
    .replace(/(\d)\s*bf\b/gi, "$1 board feet")
    .replace(/\bsq\.? ?ft\b/gi, "square feet")
    .replace(/(\d)\s*lbs?\b/gi, "$1 pounds")
    .replace(/\b(jobs?|leads?|quotes?|orders?|trips?)\s*#\s*(\d)/gi, "$1 $2")
    .replace(/#\s*(\d)/g, "number $1")
    .replace(/\s+/g, " ")
    .trim();
}
