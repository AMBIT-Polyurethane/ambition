"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { dict, errText } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

// ADC customer accounts. Anyone can make one; it only opens their own ADC account (never AMBIT Intelligence).
// Our own emails confirm the address and reset passwords (from orders@, through the app's mail), not Supabase's sender.

export type AdcFormState = { error?: string; ok?: string; sent?: string } | null;

const clean = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function ip() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 60);
}

/** Slow down anyone hammering sign-ups or password emails: per email, per network address, and in all. */
async function throttled(kind: string, email: string): Promise<boolean> {
  if (!serviceReady()) return false;
  const db = serviceClient();
  const addr = await ip();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [byEmail, byIp, all] = await Promise.all([
    db.from("adc_auth_events").select("id", { count: "exact", head: true }).eq("kind", kind).eq("email", email).gte("at", since),
    addr ? db.from("adc_auth_events").select("id", { count: "exact", head: true }).eq("ip", addr).gte("at", since) : Promise.resolve({ count: 0 }),
    db.from("adc_auth_events").select("id", { count: "exact", head: true }).eq("kind", kind).gte("at", since),
  ]);
  if ((byEmail.count ?? 0) >= 4 || (byIp.count ?? 0) >= 20 || (all.count ?? 0) >= 300) return true;
  await db.from("adc_auth_events").insert({ kind, email, ip: addr || null });
  return false;
}

function adcEmail(title: string, inner: string, foot: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0a0a0b;">
<tr><td style="background:#0A0A0B;padding:18px 24px;border-bottom:4px solid #E33527;"><span style="font-size:24px;font-weight:900;letter-spacing:3px;color:#F5F5F7;">AD</span><span style="font-size:24px;font-weight:900;letter-spacing:3px;color:#E33527;">C</span>
<span style="float:right;font-size:12px;color:#B4B4BC;line-height:30px;">${esc(title)}</span></td></tr>
<tr><td style="padding:24px;">${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#71717a;">${foot}</td></tr>
</table></td></tr></table></body></html>`;
}

function linkEmail(es: boolean, kind: "confirm" | "reset", link: string, name: string) {
  const first = esc((name || "").split(/\s+/)[0] ?? "");
  const L =
    kind === "confirm"
      ? es
        ? { t: "Confirme su correo", h: `${first ? `${first}, c` : "C"}onfirme su correo para terminar su cuenta de ADC.`, b: "CONFIRMAR MI CORREO", s: "Confirme su cuenta de ADC" }
        : { t: "Confirm your email", h: `${first ? `${first}, c` : "C"}onfirm your email to finish your ADC account.`, b: "CONFIRM MY EMAIL", s: "Confirm your ADC account" }
      : es
        ? { t: "Cambiar contraseña", h: "Toque el botón para crear una contraseña nueva para su cuenta de ADC.", b: "CREAR CONTRASEÑA NUEVA", s: "Cambie su contraseña de ADC" }
        : { t: "Reset your password", h: "Tap the button to make a new password for your ADC account.", b: "MAKE A NEW PASSWORD", s: "Reset your ADC password" };
  const note = es ? "Si usted no pidió esto, ignore este correo." : "If you didn't ask for this, you can ignore this email.";
  const inner = `<div style="font-size:20px;font-weight:800;margin-bottom:14px;">${L.h}</div>
<p style="margin:20px 0;"><a href="${esc(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 20px;border-radius:8px;">${L.b}</a></p>
<p style="margin:0;font-size:12px;color:#71717a;">${note}<br><span style="word-break:break-all;">${esc(link)}</span></p>`;
  return { subject: L.s, html: adcEmail(L.t, inner, "ADC · AMBIT Distribution Centers · orders@ambitpu.com"), text: `${L.h} ${link}` };
}

/** Make an account: the login is made now, and our email confirms the address (it signs them in). */
export async function adcSignUp(_p: AdcFormState, f: FormData): Promise<AdcFormState> {
  const lang = await adcLang();
  const t = dict(lang);
  if (clean(f.get("website"), 200)) return { sent: "ok" };
  const email = clean(f.get("email"), 160).toLowerCase();
  const name = clean(f.get("name"), 120);
  const password = String(f.get("password") ?? "");
  if (name.length < 2) return { error: errText("Please add your name.", lang) };
  if (!okEmail(email)) return { error: errText("Please add a good email address.", lang) };
  if (password.length < 8) return { error: t.pwShort };
  if (!serviceReady()) return { error: "Accounts aren't switched on yet. Please check out as a guest." };
  if (await throttled("signup", email)) return { error: t.tooMany };
  const meta = {
    full_name: name,
    company: clean(f.get("company"), 160),
    phone: clean(f.get("phone"), 40),
    promo_opt_in: f.get("promo") === "on",
    adc_signup: "1",
  };
  const db = serviceClient();
  const { data, error } = await db.auth.admin.generateLink({ type: "signup", email, password, options: { data: meta } });
  if (error || !data?.properties?.hashed_token) {
    if (error && /registered|exists|already/i.test(error.message)) return { error: t.exists };
    return { error: error?.message ?? "That didn't go through. Please try again." };
  }
  const origin = await currentOrigin();
  const link = `${origin}/auth/callback?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${data.properties.verification_type || "signup"}&next=${encodeURIComponent("/adc/account?welcome=1")}`;
  const m = linkEmail(lang === "es", "confirm", link, name);
  const sent = await sendEmail({ to: [email], fromName: "ADC · AMBIT Distribution Centers", subject: m.subject, html: m.html, text: m.text });
  if (sent.status !== "sent") return { error: "We couldn't send the confirmation email just now. Please try again in a minute, or check out as a guest." };
  return { sent: email, ok: t.checkEmail(email) };
}

export async function adcResendConfirm(_p: AdcFormState, f: FormData): Promise<AdcFormState> {
  const lang = await adcLang();
  const t = dict(lang);
  const email = clean(f.get("email"), 160).toLowerCase();
  if (!okEmail(email) || !serviceReady()) return { error: t.badLogin };
  if (await throttled("resend", email)) return { error: t.tooMany };
  // A magic link signs them in and confirms the address (only if the login exists; we never say either way).
  const { data } = await serviceClient().auth.admin.generateLink({ type: "magiclink", email });
  if (data?.properties?.hashed_token) {
    const origin = await currentOrigin();
    const link = `${origin}/auth/callback?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${data.properties.verification_type || "magiclink"}&next=${encodeURIComponent("/adc/account?welcome=1")}`;
    const m = linkEmail(lang === "es", "confirm", link, "");
    await sendEmail({ to: [email], fromName: "ADC · AMBIT Distribution Centers", subject: m.subject, html: m.html, text: m.text });
  }
  return { sent: email, ok: t.checkEmail(email) };
}

export async function adcSignIn(_p: AdcFormState, f: FormData): Promise<AdcFormState> {
  const t = dict(await adcLang());
  const email = clean(f.get("email"), 160).toLowerCase();
  const password = String(f.get("password") ?? "");
  if (!okEmail(email) || !password) return { error: t.badLogin };
  if (await throttled("signin", email)) return { error: t.tooMany };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/confirm/i.test(error.message)) return { error: t.notVerified, sent: email };
    return { error: t.badLogin };
  }
  const { data: u } = await supabase.auth.getUser();
  const { data: p } = await supabase.from("profiles").select("partner_id").eq("id", u.user?.id ?? "").maybeSingle<{ partner_id: string | null }>();
  if (p?.partner_id) {
    await supabase.auth.signOut();
    return { error: t.otherStore };
  }
  const next = clean(f.get("next"), 200);
  redirect(next.startsWith("/adc") && !next.startsWith("//") ? next : "/adc/account");
}

export async function adcSignOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/adc");
}

export async function adcForgot(_p: AdcFormState, f: FormData): Promise<AdcFormState> {
  const lang = await adcLang();
  const t = dict(lang);
  const email = clean(f.get("email"), 160).toLowerCase();
  if (!okEmail(email)) return { error: errText("Please add a good email address.", lang) };
  if (!serviceReady()) return { ok: t.linkSent };
  if (await throttled("reset", email)) return { error: t.tooMany };
  const { data } = await serviceClient().auth.admin.generateLink({ type: "recovery", email });
  if (data?.properties?.hashed_token) {
    const origin = await currentOrigin();
    const link = `${origin}/auth/callback?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${data.properties.verification_type || "recovery"}&next=${encodeURIComponent("/adc/account/reset")}`;
    const m = linkEmail(lang === "es", "reset", link, "");
    await sendEmail({ to: [email], fromName: "ADC · AMBIT Distribution Centers", subject: m.subject, html: m.html, text: m.text });
  }
  return { ok: t.linkSent };
}

export async function adcResetPassword(_p: AdcFormState, f: FormData): Promise<AdcFormState> {
  const t = dict(await adcLang());
  const password = String(f.get("password") ?? "");
  if (password.length < 8) return { error: t.pwShort };
  if (password !== String(f.get("confirm") ?? "")) return { error: t.pwMatch };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/adc/account");
}

export async function adcSaveAccount(_p: AdcFormState, f: FormData): Promise<AdcFormState> {
  const t = dict(await adcLang());
  const supabase = await createClient();
  const g = (k: string, n: number) => clean(f.get(k), n);
  const { error } = await supabase.rpc("adc_account_save", {
    p: { name: g("name", 120), company: g("company", 160), phone: g("phone", 40), street: g("street", 160), city: g("city", 80), state: g("state", 2), zip: g("zip", 10), promo_opt_in: f.get("promo") === "on" },
  });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  return { ok: t.saved };
}

/** "Tell me when it's ready" on the merch page. */
export async function adcNotifyMe(_p: AdcFormState, f: FormData): Promise<AdcFormState> {
  const t = dict(await adcLang());
  if (clean(f.get("website"), 200)) return { ok: t.notifyDone };
  const supabase = await createClient();
  const { error } = await supabase.rpc("adc_promo_signup", { p_email: clean(f.get("email"), 160), p_name: clean(f.get("name"), 120), p_source: "merch" });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  return { ok: t.notifyDone };
}
