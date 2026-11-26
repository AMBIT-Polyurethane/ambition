import { serviceClient } from "@/lib/supabase/service";
import { twilioForm } from "../shared";

// Twilio tells us when a text was delivered (or failed). Updates the text log.
// Twilio's updates can arrive out of order ("failed" before "queued"), so a later step never overwrites a final one.
export const dynamic = "force-dynamic";

const RANK: Record<string, number> = { accepted: 1, scheduled: 1, queued: 2, sending: 3, sent: 4, delivered: 9, undelivered: 9, failed: 9, canceled: 9, read: 9 };

export async function POST(req: Request) {
  const f = await twilioForm(req);
  if (!f) return new Response("Bad signature", { status: 403 });
  const sid = f.MessageSid ?? f.SmsSid;
  let status = (f.MessageStatus ?? f.SmsStatus ?? "").toLowerCase() || null;
  if (sid) {
    const db = serviceClient();
    const error = f.ErrorCode ? `Twilio error ${f.ErrorCode}` : null;
    if (error && status && (RANK[status] ?? 0) < 9) status = "failed";
    const { data: row } = await db.from("sms_log").select("status").eq("sid", sid).maybeSingle();
    const was = (row?.status as string | null) ?? null;
    const keep = was && (RANK[was] ?? 0) >= 9 && (RANK[status ?? ""] ?? 0) < 9;
    await db
      .from("sms_log")
      .update({ ...(keep ? {} : { status }), ...(error ? { error } : {}), updated_at: new Date().toISOString() })
      .eq("sid", sid);
  }
  return new Response(null, { status: 204 });
}
