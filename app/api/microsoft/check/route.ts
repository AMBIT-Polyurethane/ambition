import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { graphToken } from "@/lib/email";

// Admins: why can't the app send email from the Microsoft 365 mailbox? Gets the app's own Microsoft token (the
// one email uses) and lists the Application permissions inside it. Never shows the token or any secret.
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin" || s.profile.status !== "active") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const sender = process.env.MS_SENDER_MAILBOX ?? null;
  const set = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_SENDER_MAILBOX"].filter((k) => !process.env[k]);
  if (set.length) return NextResponse.json({ sender, verdict: `Missing in Vercel: ${set.join(", ")}.` });
  let roles: string[] = [];
  let app: string | null = null;
  let token: string;
  try {
    token = await graphToken();
  } catch (e) {
    return NextResponse.json({
      sender,
      app_sign_in: "failed",
      error: e instanceof Error ? e.message : String(e),
      verdict: "The app couldn't sign in to Microsoft with its client ID and secret (the secret may have expired or been mistyped in Vercel).",
    });
  }
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { roles?: string[]; app_displayname?: string };
    roles = claims.roles ?? [];
    app = claims.app_displayname ?? null;
  } catch {
    return NextResponse.json({ sender, app_sign_in: "ok", verdict: "Signed in, but Microsoft's token couldn't be read to list its permissions." });
  }
  const send = roles.some((r) => /^Mail\.Send$/i.test(r));
  return NextResponse.json({
    sender,
    app_sign_in: "ok",
    app,
    application_permissions: roles,
    has_mail_send: send,
    verdict: send
      ? `Mail.Send is granted as an Application permission. If sending from ${sender} is still denied, Exchange limits which mailboxes this app may use (an application access policy or RBAC for Applications scope): ${sender} has to be added to that group or scope.`
      : `The app's token has no Mail.Send Application permission. In Entra > App registrations > ${app ?? "the app"} > API permissions, add Microsoft Graph > Application permissions > Mail.Send (not Delegated), then click "Grant admin consent".`,
  });
}
