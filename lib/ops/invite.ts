import "server-only";
import { escapeHtml as h, firstName } from "@/lib/format";
import { sendEmail, wrapEmail, type SendResult } from "@/lib/email";
import { opsRoleLabel } from "@/lib/ops/roles";

// AMBIT-OPS team invites: "Cory at KOOL Foam added you to their team." Same private-link system as
// AMBIT's account invites (lib/invites.ts); this is only the letter.

type Letter = {
  email: string;
  name: string | null;
  role: string;
  company: string;
  by: string;
  link: string;
  /** They already have a login: sign in instead of making a password. */
  existing?: boolean;
};

export function opsInviteLetter(l: Letter): { subject: string; html: string; text: string } {
  const hi = firstName(l.name, l.email);
  const role = opsRoleLabel(l.role);
  const owner = l.role === "owner";
  const subject = owner ? `Your AMBIT-OPS workspace for ${l.company} is ready` : `${l.by} added you to ${l.company} on AMBIT-OPS`;
  const what = owner
    ? `AMBIT turned on AMBIT-OPS for ${l.company}: your customers, leads, quotes, schedule, crews and job costing in one place, built for spray foam and insulation. You're set up as the owner.`
    : `${l.by} added you to ${l.company}'s team on AMBIT-OPS as ${role.toLowerCase()}.`;
  const action = l.existing ? "SIGN IN" : "SET UP MY LOGIN";
  const how = l.existing
    ? `Sign in with ${l.email} and your password.`
    : `Tap the button, create a password, and you're in. This link is just for ${l.email} and works for 30 days.`;
  const html = wrapEmail(
    "AMBIT-OPS",
    `<div style="font-size:22px;font-weight:800;margin-bottom:10px;">Hi ${h(hi)},</div>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px;">${h(what)}</p>
<p style="margin:0 0 16px;"><a href="${h(l.link)}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">${action}</a></p>
<p style="font-size:13px;line-height:1.5;color:#52525b;margin:0 0 8px;">${h(how)}</p>
<p style="font-size:13px;line-height:1.5;color:#52525b;margin:0;">Tip: on your phone, open the link and choose "Add to Home Screen" to use it like an app.</p>
<p style="font-size:11px;color:#a1a1aa;margin:16px 0 0;word-break:break-all;">Button not working? Copy this into your browser: ${h(l.link)}</p>`,
  );
  const text = [`Hi ${hi}, ${what}`, l.existing ? `Sign in here with ${l.email}:` : `Set up your login here (just for ${l.email}, works for 30 days):`, l.link].join("\n");
  return { subject, html, text };
}

export async function sendOpsInvite(l: Letter): Promise<SendResult & { subject: string; text: string }> {
  const letter = opsInviteLetter(l);
  const res = await sendEmail({ to: [l.email], subject: letter.subject, html: letter.html, text: letter.text });
  return { ...res, subject: letter.subject, text: letter.text };
}
