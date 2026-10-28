import "server-only";

export type EmailAttachment = { filename: string; content: Buffer; contentType?: string };

export type EmailMessage = {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
};

export type SendResult = { status: "sent" | "failed" | "not_configured"; error?: string };

function clean(list: (string | null | undefined)[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list ?? []) {
    const e = (raw ?? "").trim();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

async function sendWithResend(msg: EmailMessage): Promise<SendResult> {
  const from = process.env.EMAIL_FROM || "AMBIT Intelligence <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: msg.to,
      cc: msg.cc && msg.cc.length ? msg.cc : undefined,
      reply_to: msg.replyTo || undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments?.length
        ? msg.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") }))
        : undefined,
    }),
  });
  if (res.ok) return { status: "sent" };
  return { status: "failed", error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
}

/** An app-only Microsoft Graph token (client credentials): what email sending uses. */
export async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    body,
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(json.error_description || `token ${res.status}`);
  return json.access_token;
}

async function sendWithGraph(msg: EmailMessage): Promise<SendResult> {
  const sender = process.env.MS_SENDER_MAILBOX!;
  const token = await graphToken();
  const addr = (a: string) => ({ emailAddress: { address: a } });
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: msg.subject,
        body: { contentType: "HTML", content: msg.html },
        toRecipients: msg.to.map(addr),
        ccRecipients: (msg.cc ?? []).map(addr),
        replyTo: msg.replyTo ? [addr(msg.replyTo)] : [],
        attachments: (msg.attachments ?? []).map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.filename,
          contentType: a.contentType ?? "application/octet-stream",
          contentBytes: a.content.toString("base64"),
        })),
      },
      saveToSentItems: true,
    }),
  });
  if (res.status === 202 || res.ok) return { status: "sent" };
  return { status: "failed", error: `Microsoft ${res.status}: ${(await res.text()).slice(0, 1200)}` };
}

/**
 * True when email can reach people outside AMBIT: a verified sending domain in Resend (EMAIL_FROM set)
 * or Microsoft 365 sending. Resend's test sender (onboarding@resend.dev) only reaches the account owner.
 */
export function canEmailCustomers(): boolean {
  if (process.env.RESEND_API_KEY) return Boolean(process.env.EMAIL_FROM && !/resend\.dev/i.test(process.env.EMAIL_FROM));
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_SENDER_MAILBOX);
}

export function emailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY ||
      (process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_SENDER_MAILBOX),
  );
}

export async function sendEmail(input: EmailMessage): Promise<SendResult> {
  const msg: EmailMessage = {
    ...input,
    to: clean(input.to),
    cc: clean(input.cc).filter((c) => !clean(input.to).some((t) => t.toLowerCase() === c.toLowerCase())),
  };
  if (msg.to.length === 0) return { status: "failed", error: "No valid recipient" };
  try {
    if (process.env.RESEND_API_KEY) return await sendWithResend(msg);
    if (process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_SENDER_MAILBOX) {
      return await sendWithGraph(msg);
    }
    console.log(`[email not configured] would send "${msg.subject}" to ${msg.to.join(", ")}`);
    return { status: "not_configured" };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

// A simple branded wrapper for any email body.
export function wrapEmail(title: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f4;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
<tr><td style="background:#0A0A0B;padding:18px 24px;border-bottom:4px solid #E33527;">
<span style="font-size:20px;font-weight:800;letter-spacing:2px;color:#ffffff;">AMBIT</span><span style="font-size:20px;font-weight:800;letter-spacing:2px;color:#E33527;"> A.I.</span>
<span style="float:right;font-size:12px;color:#B4B4BC;line-height:26px;">${title}</span>
</td></tr>
<tr><td style="padding:24px;">${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#71717a;">Sent by the AMBIT Intelligence app · AMBIT Polyurethane</td></tr>
</table></td></tr></table></body></html>`;
}
