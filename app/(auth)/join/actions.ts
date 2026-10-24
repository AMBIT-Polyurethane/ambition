"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentOrigin } from "@/lib/origin";
import { hashToken } from "@/lib/invites";

// The invite page: the person makes their password (or signs in), and the account
// is set up the way the admin chose.

export type JoinState = { error?: string; ok?: string } | null;
type Info = { email: string; full_name: string | null; phone: string | null; kind: string; company_name: string | null; invited_by_name: string | null; state: string; has_account: boolean };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const GONE = "This invite link has expired or was already used. Ask AMBIT to send a new one, or sign in if you've already set up your login.";

async function lookup(token: string) {
  const supabase = await createClient();
  const hash = hashToken(token);
  const { data } = await supabase.rpc("invite_lookup", { p_hash: hash });
  const info = (Array.isArray(data) ? data[0] : data) as Info | undefined;
  return { supabase, hash, info: info && info.state === "open" ? info : null };
}

export async function joinCreate(_prev: JoinState, form: FormData): Promise<JoinState> {
  const token = str(form, "token");
  const full_name = str(form, "full_name");
  const phone = str(form, "phone");
  const password = String(form.get("password") ?? "");
  if (!full_name) return { error: "Type your name." };
  if (password.length < 8) return { error: "Use a password with at least 8 characters." };

  const { supabase, hash, info } = await lookup(token);
  if (!info) return { error: GONE };
  if (info.has_account) return { error: "You already have an AMBITION login. Reload this page to sign in." };

  const origin = await currentOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: info.email.toLowerCase(),
    password,
    options: {
      data: { full_name, phone, invite: hash },
      emailRedirectTo: `${origin}/auth/callback?next=/`,
    },
  });
  if (error) {
    if (/registered|exists/i.test(error.message)) return { error: "You already have an AMBITION login. Reload this page to sign in." };
    return { error: error.message };
  }
  if (!data.session) {
    return { ok: "Almost done: we emailed you a link to confirm your address. Tap it, then sign in with your email and new password." };
  }
  // Belt and braces: the database already used the invite when the login was made.
  await supabase.rpc("accept_invite", { p_hash: hash });
  redirect("/?welcome=1");
}

export async function joinSignIn(_prev: JoinState, form: FormData): Promise<JoinState> {
  const token = str(form, "token");
  const password = String(form.get("password") ?? "");
  if (!password) return { error: "Type your password." };
  const { supabase, hash, info } = await lookup(token);
  if (!info) return { error: GONE };
  const { error } = await supabase.auth.signInWithPassword({ email: info.email.toLowerCase(), password });
  if (error) return { error: "That password doesn't match. Try again, or tap Forgot password." };
  await supabase.rpc("accept_invite", { p_hash: hash });
  redirect("/?welcome=1");
}

/** Already signed in as the invited email: just finish. */
export async function joinFinish(form: FormData) {
  const { supabase, hash, info } = await lookup(str(form, "token"));
  if (info) await supabase.rpc("accept_invite", { p_hash: hash });
  redirect("/?welcome=1");
}
