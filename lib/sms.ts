import "server-only";
import crypto from "node:crypto";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { currentOrigin } from "@/lib/origin";

// Text messages through Twilio (0118). Three settings in Vercel: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
// TWILIO_MESSAGING_SERVICE_SID (the service that holds the approved A2P campaign and the texting number).
// Never throws: a text that can't go out is logged with the reason, and whatever called it carries on.

const SID = () => (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
const TOKEN = () => (process.env.TWILIO_AUTH_TOKEN ?? "").trim();
const SERVICE = () => (process.env.TWILIO_MESSAGING_SERVICE_SID ?? "").trim();
const FROM = () => (process.env.TWILIO_FROM_NUMBER ?? "").trim();
const API = () => (process.env.TWILIO_API_BASE ?? "https://api.twilio.com").replace(/\/$/, "");

export const smsReady = () => Boolean(SID() && TOKEN() && (SERVICE() || FROM()) && serviceReady());
export const smsSetup = () => ({ account: Boolean(SID()), token: Boolean(TOKEN()), service: Boolean(SERVICE()), from: Boolean(FROM()) });

/** A US number as +1XXXXXXXXXX, or null. */
export function e164(p: string | null | undefined): string | null {
  const d = String(p ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
export const prettyPhone = (p: string | null | undefined) => {
  const d = String(p ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p ?? "");
};

export type SmsResult = { status: "sent" | "skipped" | "failed" | "not_configured"; error?: string; sid?: string };
type Kind = "approval" | "scheduled" | "done" | "handoff" | "waiting" | "test" | "reply";
const STOP = " Reply STOP to opt out.";

/** Sends one text and logs it. Customer texts end with the STOP line (it's added if missing). */
export async function sendSms(input: { to: string; body: string; kind: Kind; ref?: string | null; userId?: string | null; stopLine?: boolean }): Promise<SmsResult> {
  const to = e164(input.to);
  let body = input.body.trim();
  if (input.stopLine !== false && !/reply stop/i.test(body)) body += STOP;
  body = body.slice(0, 640);
  if (!smsReady()) return { status: "not_configured", error: "Texting isn't set up in Vercel yet." };
  const db = serviceClient();
  const log = async (status: string, extra: { sid?: string; error?: string; from?: string | null } = {}) => {
    await db.from("sms_log").insert({ direction: "out", to_phone: to ?? input.to, from_phone: extra.from ?? null, kind: input.kind, ref: input.ref ?? null, user_id: input.userId ?? null, body, status, sid: extra.sid ?? null, error: extra.error ?? null });
  };
  if (!to) {
    await log("skipped", { error: "Not a US mobile number" });
    return { status: "skipped", error: "Not a US mobile number" };
  }
  const { data: out } = await db.from("sms_optout").select("phone").eq("phone", to).maybeSingle();
  if (out) {
    await log("skipped", { error: "Replied STOP" });
    return { status: "skipped", error: "That number replied STOP" };
  }
  try {
    const form = new URLSearchParams({ To: to, Body: body });
    if (SERVICE()) form.set("MessagingServiceSid", SERVICE()); else form.set("From", FROM());
    const origin = await currentOrigin().catch(() => "");
    if (origin.startsWith("https://")) form.set("StatusCallback", `${origin}/api/twilio/status`);
    const res = await fetch(`${API()}/2010-04-01/Accounts/${SID()}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${SID()}:${TOKEN()}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number; from?: string | null; messaging_service_sid?: string | null };
    if (!res.ok || !j.sid) {
      const error = `${j.message ?? `Twilio said ${res.status}`}${j.code ? ` (${j.code})` : ""}`;
      // 21610: the number replied STOP to us at Twilio. Remember it here too.
      if (j.code === 21610) await db.from("sms_optout").upsert({ phone: to, said: "STOP (Twilio)" });
      await log("failed", { error });
      return { status: "failed", error };
    }
    // Which number (or Messaging Service) Twilio sent it from: the status update fills in the number later.
    await log(j.status ?? "queued", { sid: j.sid, from: j.from || j.messaging_service_sid || null });
    return { status: "sent", sid: j.sid };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Couldn't reach Twilio";
    await log("failed", { error });
    return { status: "failed", error };
  }
}

/** What Twilio's common error codes mean, in plain words (Admin > Texting). */
const TWILIO_ERRORS: Record<string, string> = {
  "30034": "Twilio blocked it: the texting number isn't tied to the approved campaign yet. Check the number is in the Messaging Service that holds the campaign.",
  "30035": "The texting number is still being registered with the phone companies. It usually clears within 24 hours.",
  "30007": "The phone company filtered it as possible spam.",
  "30003": "The phone was off or out of service.",
  "30005": "That number doesn't exist or isn't in service.",
  "30006": "That's a landline or a number that can't get texts.",
  "21610": "That number replied STOP.",
  "21211": "That isn't a valid phone number.",
  "21608": "Trial accounts can only text verified numbers.",
};
export function smsErrorText(error: string | null | undefined): string | null {
  const code = String(error ?? "").match(/\b(\d{5})\b/)?.[1];
  return code ? TWILIO_ERRORS[code] ?? null : null;
}

/** Staff who turned text alerts on (Profile), among these people. */
export async function textStaff(userIds: string[], body: string, kind: Kind, ref?: string | null): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length || !smsReady()) return 0;
  const db = serviceClient();
  const { data } = await db.from("profiles").select("id, sms_phone, sms_on, role, status").in("id", ids);
  let n = 0;
  for (const p of (data ?? []) as { id: string; sms_phone: string | null; sms_on: boolean; role: string; status: string }[]) {
    if (!p.sms_on || !p.sms_phone || p.status !== "active" || (p.role !== "admin" && p.role !== "employee")) continue;
    const r = await sendSms({ to: p.sms_phone, body, kind, ref, userId: p.id });
    if (r.status === "sent") n++;
  }
  return n;
}

/** Admins with text alerts on: something is waiting on them. */
export async function textAdmins(body: string, ref?: string | null): Promise<number> {
  if (!smsReady()) return 0;
  const db = serviceClient();
  const { data } = await db.from("profiles").select("id").eq("role", "admin").eq("status", "active").eq("sms_on", true);
  return textStaff(((data ?? []) as { id: string }[]).map((p) => p.id), body, "waiting", ref);
}

/** Twilio signs every webhook (X-Twilio-Signature): HMAC-SHA1 of the URL plus the sorted form fields. */
export function twilioSignatureOk(url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature || !TOKEN()) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const want = crypto.createHmac("sha1", TOKEN()).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(want), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
