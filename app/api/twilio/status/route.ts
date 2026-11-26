import { serviceClient } from "@/lib/supabase/service";
import { twilioForm } from "../shared";

// Twilio tells us when a text was delivered (or failed). Updates the text log.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const f = await twilioForm(req);
  if (!f) return new Response("Bad signature", { status: 403 });
  const sid = f.MessageSid ?? f.SmsSid;
  if (sid) {
    const error = f.ErrorCode ? `Twilio error ${f.ErrorCode}` : null;
    await serviceClient().from("sms_log").update({ status: f.MessageStatus ?? f.SmsStatus ?? null, ...(error ? { error } : {}), updated_at: new Date().toISOString() }).eq("sid", sid);
  }
  return new Response(null, { status: 204 });
}
