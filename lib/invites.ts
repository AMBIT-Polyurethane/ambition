import "server-only";
import { createHash, randomBytes } from "crypto";
import { escapeHtml as h, firstName } from "@/lib/format";
import { sendEmail, wrapEmail, type SendResult } from "@/lib/email";

// Accounts an admin creates: the person gets a private link to set their password.

export type InviteKind = "contractor" | "employee";

/** What the admin sees after creating (or re-sending) an invite. */
export type InviteResult =
  | {
      ok: true;
      email: string;
      name: string | null;
      phone: string | null;
      /** They already had a login, so it was updated instead of invited. */
      existing: boolean;
      link: string;
      emailStatus: SendResult["status"];
      emailError?: string;
      subject: string;
      text: string;
    }
  | { ok: false; error: string }
  | null;

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

type Letter = {
  email: string;
  name: string | null;
  kind: InviteKind;
  company: string | null;
  by: string;
  note: string | null;
  link: string;
  /** Their login already existed: tell them to sign in instead of setting a password. */
  existing?: boolean;
};

/** The invite email (and the same words as plain text, for texting or pasting into Outlook). */
export function inviteLetter(l: Letter): { subject: string; html: string; text: string } {
  const hi = firstName(l.name, l.email);
  const what =
    l.kind === "employee"
      ? "the AMBIT team side of the app: ordering for customers, internal forms, the company directory, product docs and AMBIT Academy"
      : `ordering${l.company ? ` for ${l.company}` : ""}, product docs, tech bulletins and AMBIT Academy training`;
  const subject = l.existing ? "Your AMBIT Intelligence account is ready" : `${l.by} set up your AMBIT Intelligence account`;
  const action = l.existing ? "SIGN IN TO AMBIT A.I." : "SET UP MY LOGIN";
  const how = l.existing
    ? `Sign in with ${l.email} and your password. Forgot it? Tap "Forgot password?" on the sign-in screen.`
    : `Tap the button, create a password, and you're in. This link is just for ${l.email} and works for 30 days.`;

  const html = wrapEmail(
    "Your account",
    `<div style="font-size:22px;font-weight:800;margin-bottom:10px;">Hi ${h(hi)}, welcome to AMBIT Intelligence.</div>
<p style="font-size:15px;line-height:1.5;margin:0 0 14px;">${h(l.by)} at AMBIT Polyurethane ${l.existing ? "set up" : "created"} an AMBIT Intelligence account for you. AMBIT Intelligence (A.I.) is AMBIT's app. You'll have ${h(what)}.</p>
${l.note ? `<p style="font-size:14px;line-height:1.5;margin:0 0 16px;padding:12px 14px;background:#f4f4f5;border-left:3px solid #E33527;border-radius:4px;">${h(l.note).replace(/\n/g, "<br>")}<br><span style="color:#71717a;font-size:12px;">${h(l.by)}</span></p>` : ""}
<p style="margin:0 0 16px;"><a href="${h(l.link)}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">${action}</a></p>
<p style="font-size:13px;line-height:1.5;color:#52525b;margin:0 0 8px;">${h(how)}</p>
<p style="font-size:13px;line-height:1.5;color:#52525b;margin:0;">Tip: on your phone, open AMBIT Intelligence and choose "Add to Home Screen" to use it like an app.</p>
<p style="font-size:11px;color:#a1a1aa;margin:16px 0 0;word-break:break-all;">Button not working? Copy this into your browser: ${h(l.link)}</p>`,
  );

  const text = [
    `Hi ${hi}, ${l.by} at AMBIT Polyurethane ${l.existing ? "set up" : "created"} an AMBIT Intelligence account for you (AMBIT's app for ${l.kind === "employee" ? "the AMBIT team" : "ordering, product docs and training"}).`,
    l.note ? `\n${l.note}\n` : "",
    l.existing ? `Sign in here with ${l.email} and your password:` : `Set up your login here (just for ${l.email}, works for 30 days):`,
    l.link,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export async function sendInvite(l: Letter): Promise<SendResult & { subject: string; text: string }> {
  const letter = inviteLetter(l);
  const res = await sendEmail({ to: [l.email], subject: letter.subject, html: letter.html, text: letter.text });
  return { ...res, subject: letter.subject, text: letter.text };
}
