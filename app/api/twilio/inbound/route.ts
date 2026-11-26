import { serviceClient } from "@/lib/supabase/service";
import { e164 } from "@/lib/sms";
import { twilioForm, twiml } from "../shared";

// Someone texted the AMBIT number. STOP turns texts off for that number, START turns them back on (Twilio sends its
// own confirmation for those and for HELP). Anything else gets one line back saying where to reach a person.
export const dynamic = "force-dynamic";

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*$/i;
const START = /^\s*(start|unstop|yes|subscribe)\s*$/i;
const HELP = /^\s*(help|info)\s*$/i;

export async function POST(req: Request) {
  const f = await twilioForm(req);
  if (!f) return new Response("Bad signature", { status: 403 });
  const from = e164(f.From) ?? f.From ?? "";
  const body = (f.Body ?? "").slice(0, 640);
  const db = serviceClient();
  await db.from("sms_log").insert({ direction: "in", from_phone: from, to_phone: f.To ?? null, kind: "reply", body, status: "received", sid: f.MessageSid ?? null });
  if (STOP.test(body)) {
    await db.from("sms_optout").upsert({ phone: from, said: body.trim().slice(0, 40), at: new Date().toISOString() });
    await db.from("profiles").update({ sms_on: false }).eq("sms_phone", from);
    return twiml();
  }
  if (START.test(body)) {
    await db.from("sms_optout").delete().eq("phone", from);
    return twiml();
  }
  if (HELP.test(body)) return twiml();
  return twiml("AMBIT Polyurethane: this number sends order updates and can't read replies. Call your AMBIT rep or email orders@ambitpu.com. Reply STOP to opt out.");
}
