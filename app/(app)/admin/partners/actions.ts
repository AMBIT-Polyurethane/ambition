"use server";

import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/session";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { getPartner } from "@/lib/partner-store";
import { partnerPasswordEmail } from "@/lib/partner-email";

type R = { ok: true; message: string } | { ok: false; error: string };

/** Hand a store's owner login to the owner: a new password nobody knows (the old one stops working, and anyone signed
 *  in as the owner is signed out), then an email so the owner makes their own password. Only the store's AMBIT viewer. */
export async function handOverOwner(slug: string): Promise<R> {
  const { supabase } = await requireAdmin();
  const { data: can } = await supabase.rpc("can_view_partner", { p: slug });
  if (can !== true) return { ok: false, error: "Only the store's AMBIT contact can do this." };
  if (!serviceReady()) return { ok: false, error: "The server key isn't set up, so this can't be sent." };
  const db = serviceClient();
  const { data: prof } = await db.from("profiles").select("id, email, full_name").eq("partner_id", slug).eq("partner_role", "owner").limit(1).maybeSingle<{ id: string; email: string; full_name: string | null }>();
  if (!prof) return { ok: false, error: "There's no owner login yet. Send the owner invite instead." };
  const p = await getPartner(slug);
  if (!p) return { ok: false, error: "Store not found." };

  // 1) A password nobody knows, so whatever was used before stops working.
  const { error: pwErr } = await db.auth.admin.updateUserById(prof.id, { password: `${randomBytes(24).toString("base64url")}Aa1!` });
  if (pwErr) return { ok: false, error: `Couldn't reset the login: ${pwErr.message}` };
  // 2) Anyone still signed in as the owner (a test, a demo) is signed out (0114).
  await db.rpc("partner_owner_signout", { p_partner: slug });
  // 3) The owner makes their own password from the email.
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email: prof.email });
  if (error || !data?.properties?.hashed_token) return { ok: false, error: `The login was reset, but the email link couldn't be made: ${error?.message ?? "unknown"}. Ask ${prof.full_name ?? "the owner"} to use Forgot password on the store's sign-in page.` };
  const origin = await currentOrigin();
  const link = `${origin}/auth/callback?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${data.properties.verification_type || "recovery"}&next=${encodeURIComponent(`/store/${slug}/reset`)}`;
  const sent = await sendEmail({
    to: [prof.email],
    fromName: "AMBIT Polyurethane",
    subject: `Your ${p.name} store is ready for you`,
    html: partnerPasswordEmail(p, origin, link, "handover", prof.full_name),
    text: `Your ${p.name} store is ready. Make your own password here (works for 1 hour; after that use Forgot password on ${origin}/store/${slug}/signin): ${link}`,
  }).catch(() => ({ status: "failed" as const }));
  const who = prof.full_name?.split(/\s+/)[0] ?? "The owner";
  if (sent.status !== "sent") return { ok: false, error: `The login was reset, but the email didn't go out. ${who} can use Forgot password at ${origin.replace(/^https?:\/\//, "")}/store/${slug}/signin with ${prof.email}.` };
  return { ok: true, message: `Sent to ${prof.email}. The old password no longer works and anyone signed in as ${who} was signed out. ${who} makes a new password from that email (the link works for 1 hour; after that, Forgot password on the store's sign-in page).` };
}
