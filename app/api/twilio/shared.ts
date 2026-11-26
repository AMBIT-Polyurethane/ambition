import "server-only";
import { twilioSignatureOk } from "@/lib/sms";

/** The form Twilio posted, if its signature checks out (null otherwise). */
export async function twilioForm(req: Request): Promise<Record<string, string> | null> {
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) params[k] = v;
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = (req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "")).split(",")[0].trim();
  const url = `${proto}://${host}${u.pathname}${u.search}`;
  return twilioSignatureOk(url, params, req.headers.get("x-twilio-signature")) ? params : null;
}

export const twiml = (msg?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</Message>` : ""}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
