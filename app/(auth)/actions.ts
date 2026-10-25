"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentOrigin, safeNext } from "@/lib/origin";
import { ADMIN_NOTIFY_EMAIL, MICROSOFT_SIGNIN } from "@/lib/env";
import { sendEmail, wrapEmail } from "@/lib/email";
import { escapeHtml as h } from "@/lib/format";

export type FormState = { error?: string; ok?: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/confirm/i.test(error.message)) return { error: "Please confirm your email first. Check your inbox for the link." };
    return { error: "That email and password don't match. Try again or reset your password." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signInWithMicrosoft(form: FormData) {
  const supabase = await createClient();
  const origin = await currentOrigin();
  const next = safeNext(form.get("next"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      scopes: "email openid profile offline_access",
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data.url) redirect("/signin?error=microsoft");
  redirect(data.url);
}

export async function requestAccess(_prev: FormState, form: FormData): Promise<FormState> {
  const full_name = str(form, "full_name");
  const company = str(form, "company");
  const account_no = str(form, "account_no");
  const phone = str(form, "phone");
  const branch_id = str(form, "branch_id");
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!full_name || !company || !phone || !email) return { error: "Please fill in your name, company, phone and email." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address doesn't look right." };
  if (password.length < 8) return { error: "Use a password with at least 8 characters." };
  if (MICROSOFT_SIGNIN && email.endsWith("@ambitpu.com")) {
    return { error: "AMBIT employees don't need to request access. Go back and use Sign in with Microsoft." };
  }

  const supabase = await createClient();
  const origin = await currentOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name, company, account_no, phone, branch_id },
      emailRedirectTo: `${origin}/auth/callback?next=/pending`,
    },
  });
  if (error) {
    if (/registered|exists/i.test(error.message)) return { error: "An account with that email already exists. Try signing in." };
    return { error: error.message };
  }

  if (ADMIN_NOTIFY_EMAIL) {
    const rows = [
      ["Name", full_name], ["Company", company], ["AMBIT account #", account_no || "-"],
      ["Phone", phone], ["Email", email], ["Nearest branch", branch_id || "-"],
    ]
      .map(([k, v]) => `<tr><td style="padding:5px 0;width:140px;color:#71717a;font-size:13px;">${h(k)}</td><td style="padding:5px 0;font-size:14px;font-weight:600;">${h(v)}</td></tr>`)
      .join("");
    await sendEmail({
      to: [ADMIN_NOTIFY_EMAIL],
      replyTo: email,
      subject: `AMBIT Intelligence access request · ${company}`,
      html: wrapEmail(
        "Access request",
        `<div style="font-size:22px;font-weight:800;margin-bottom:12px;">New contractor access request</div>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:20px 0 0;"><a href="${h(origin)}/admin/users" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 18px;border-radius:8px;">REVIEW IN AMBIT A.I.</a></p>`,
      ),
      text: `New contractor access request\n${full_name}\n${company}\n${account_no}\n${phone}\n${email}\n\n${origin}/admin/users`,
    }).catch(() => null);
  }

  if (data.session) redirect("/pending");
  return { ok: "Almost done. We sent you an email: tap the link in it to confirm your address. AMBIT will review your request and you'll get an email when you're approved." };
}

export async function forgotPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  if (!email) return { error: "Enter your email." };
  const supabase = await createClient();
  const origin = await currentOrigin();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  return { ok: "If that email has an account, a reset link is on its way. Check your inbox." };
}

export async function updatePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/?password=updated");
}
