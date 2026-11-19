"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { canEmailCustomers, sendEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { hashToken } from "@/lib/invites";
import { getPartner, partnerMe } from "@/lib/partner-store";
import { partnerOrderEmail, type PEmailLine, type POrderMail } from "@/lib/partner-email";
import { adcLang } from "@/lib/adc-lang";
import { pdict, perrText } from "@/lib/partner-i18n";

// The shopper's side of a partner's store: checkout, sign in, passwords and invites.

const clean = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const okSlug = (s: string) => /^[a-z0-9-]{2,40}$/.test(s);

export type POrderInput = {
  name: string;
  company: string;
  email: string;
  phone: string;
  delivery: "ship" | "pickup";
  address: { street: string; city: string; state: string; zip: string };
  po: string;
  notes: string;
  website?: string;
  lang?: "en" | "es";
  items: { item_id?: string | null; sku?: string; name?: string; qty: number }[];
};
export type POrderResult = { ok: true; order_no: string } | { ok: false; error: string };

/** An order on a partner's store: saved under that store, emailed to the store (and a copy to the shopper). */
export async function placePartnerOrder(slug: string, o: POrderInput): Promise<POrderResult> {
  if (o.website) return { ok: true, order_no: "0" };
  if (!okSlug(slug)) return { ok: false, error: "This store is not open." };
  const lang: "en" | "es" = o.lang === "es" ? "es" : "en";
  const input = {
    name: clean(o.name, 120),
    company: clean(o.company, 160),
    email: clean(o.email, 160),
    phone: clean(o.phone, 40),
    delivery: o.delivery === "pickup" ? ("pickup" as const) : ("ship" as const),
    address: { street: clean(o.address?.street, 160), city: clean(o.address?.city, 80), state: clean(o.address?.state, 2), zip: clean(o.address?.zip, 10) },
    po: clean(o.po, 60),
    notes: clean(o.notes, 2000),
    lang,
    items: (Array.isArray(o.items) ? o.items : []).slice(0, 120).map((i) => ({
      item_id: i.item_id ? clean(i.item_id, 40) : null,
      sku: clean(i.sku, 40),
      name: clean(i.name, 160),
      qty: Math.max(0, Math.min(9999, Math.round(Number(i.qty) || 0))),
    })),
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partner_place_order", { p_partner: slug, p: input });
  if (error) return { ok: false, error: perrText(error.message.replace(/^.*?:\s*/, "") || "That didn't go through. Please try again.", lang) };
  const res = data as { id: number; order_no: string; subtotal: number; has_quote: boolean; items: PEmailLine[]; customer_id: string | null };

  const partner = await getPartner(slug);
  if (partner?.email) {
    const me = await partnerMe(slug);
    const origin = await currentOrigin();
    const mail: POrderMail = { ...input, account: me.kind === "customer" ? me.customer.company : null };
    const lines = (res.items ?? []).map((l) => ({ ...l, price: l.price === null ? null : Number(l.price), per_lb: l.per_lb === null || l.per_lb === undefined ? null : Number(l.per_lb) }));
    const sub = Number(res.subtotal);
    const sent = await sendEmail({
      to: [partner.email],
      fromName: `${partner.name} Web Store`,
      replyTo: input.email,
      subject: `Store order ${res.order_no}: ${input.company || input.name}${res.has_quote ? " (some prices to confirm)" : ""}`,
      html: partnerOrderEmail(partner, origin, res.order_no, mail, lines, sub, res.has_quote, false),
      text: `New store order ${res.order_no} from ${input.name} (${input.email}${input.phone ? `, ${input.phone}` : ""}). ${lines.map((l) => `${l.qty} x ${l.sku} ${l.name}`).join("; ")}. Subtotal ${usd(sub)}.`,
    });
    if (canEmailCustomers()) {
      await sendEmail({
        to: [input.email],
        fromName: partner.name,
        replyTo: partner.email,
        subject: lang === "es" ? `Recibimos su pedido ${res.order_no}` : `We got your order ${res.order_no}`,
        html: partnerOrderEmail(partner, origin, res.order_no, mail, lines, sub, res.has_quote, true),
        text:
          lang === "es"
            ? `Gracias. Recibimos su pedido ${res.order_no}. Le llamaremos o le escribiremos para confirmar el total y el envío. ${partner.name}, ${partner.phone ?? ""}`
            : `Thanks. We got your order ${res.order_no}. We'll call or email you to confirm the total and shipping. ${partner.name}, ${partner.phone ?? ""}`,
      });
    }
    await supabase.rpc("partner_mark_emailed", { p_id: res.id, p_status: sent.status });
  }
  return { ok: true, order_no: res.order_no };
}

export type PFormState = { error?: string; ok?: string } | null;

/** Where this person belongs after signing in on this store (null: not one of this store's people). */
async function homeFor(slug: string): Promise<string | null> {
  const me = await partnerMe(slug);
  if (me.kind === "owner" || me.kind === "viewer") return `/store/${slug}/desk`;
  if (me.kind === "customer") return `/store/${slug}/account`;
  return null;
}

export async function partnerSignIn(_prev: PFormState, form: FormData): Promise<PFormState> {
  const slug = clean(form.get("slug"), 40);
  const t = pdict(await adcLang());
  const email = clean(form.get("email"), 160).toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!okSlug(slug) || !email || !password) return { error: t.badLogin };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: /confirm/i.test(error.message) ? t.checkEmail : t.badLogin };
  // Signed in fine, but are they one of this store's people? (A fresh read: partnerMe is cached per request.)
  const { data: auth } = await supabase.auth.getUser();
  const { data: p } = await supabase.from("profiles").select("partner_id, partner_role").eq("id", auth.user?.id ?? "").maybeSingle<{ partner_id: string | null; partner_role: string | null }>();
  let to: string | null = null;
  if (p?.partner_id === slug) to = p.partner_role === "owner" ? `/store/${slug}/desk` : `/store/${slug}/account`;
  else if (!p?.partner_id) {
    const { data: v } = await supabase.rpc("can_view_partner", { p: slug });
    if (v === true) to = `/store/${slug}/desk`;
  }
  if (!to) {
    await supabase.auth.signOut();
    return { error: t.notHere };
  }
  const next = clean(form.get("next"), 300);
  redirect(next.startsWith(`/store/${slug}/`) && !next.startsWith("//") && p?.partner_role !== "owner" ? next : to);
}

export async function partnerSignOut(form: FormData) {
  const slug = clean(form.get("slug"), 40);
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(okSlug(slug) ? `/store/${slug}` : "/");
}

export async function partnerForgot(_prev: PFormState, form: FormData): Promise<PFormState> {
  const slug = clean(form.get("slug"), 40);
  const t = pdict(await adcLang());
  const email = clean(form.get("email"), 160).toLowerCase();
  if (!okSlug(slug) || !email) return { error: t.badLogin };
  const supabase = await createClient();
  const origin = await currentOrigin();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(`/store/${slug}/reset`)}` });
  return { ok: t.linkSent };
}

export async function partnerResetPassword(_prev: PFormState, form: FormData): Promise<PFormState> {
  const slug = clean(form.get("slug"), 40);
  const t = pdict(await adcLang());
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: t.pwShort };
  if (password !== String(form.get("confirm") ?? "")) return { error: t.pwMatch };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect((await homeFor(slug)) ?? `/store/${slug}`);
}

// ------------------------------------------------------------------ invites

type InviteInfo = { email: string; partner_id: string; partner_name: string; partner_role: "owner" | "customer"; company: string | null; state: string; has_account: boolean };

async function lookup(token: string) {
  const supabase = await createClient();
  const hash = hashToken(token);
  const { data } = await supabase.rpc("partner_invite_lookup", { p_hash: hash });
  const info = (Array.isArray(data) ? data[0] : data) as InviteInfo | undefined;
  return { supabase, hash, info: info && info.state === "open" ? info : null };
}

const after = (info: InviteInfo) => (info.partner_role === "owner" ? `/store/${info.partner_id}/desk?welcome=1` : `/store/${info.partner_id}/account?welcome=1`);

export async function partnerJoinCreate(_prev: PFormState, form: FormData): Promise<PFormState> {
  const t = pdict(await adcLang());
  const token = clean(form.get("token"), 200);
  const full_name = clean(form.get("full_name"), 120);
  const password = String(form.get("password") ?? "");
  if (full_name.length < 2) return { error: t.yourName };
  if (password.length < 8) return { error: t.pwShort };
  const { supabase, hash, info } = await lookup(token);
  if (!info) return { error: t.inviteGone };
  if (info.has_account) return { error: t.joinHas };
  const email = info.email.toLowerCase();
  if (serviceReady()) {
    // The invite link reached this inbox, so the address is confirmed: no second "confirm your email" step.
    const { error } = await serviceClient().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, partner_invite: hash } });
    if (error) return { error: /registered|exists/i.test(error.message) ? t.joinHas : error.message };
    const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
    if (e2) return { error: e2.message };
  } else {
    const origin = await currentOrigin();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name, partner_invite: hash }, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(after(info))}` },
    });
    if (error) return { error: /registered|exists/i.test(error.message) ? t.joinHas : error.message };
    if (!data.session) return { ok: t.checkEmail };
  }
  // Belt and braces: the database already used the invite when the login was made.
  await supabase.rpc("partner_accept_invite", { p_hash: hash });
  redirect(after(info));
}

export async function partnerJoinSignIn(_prev: PFormState, form: FormData): Promise<PFormState> {
  const t = pdict(await adcLang());
  const token = clean(form.get("token"), 200);
  const password = String(form.get("password") ?? "");
  const { supabase, hash, info } = await lookup(token);
  if (!info) return { error: t.inviteGone };
  const { error } = await supabase.auth.signInWithPassword({ email: info.email.toLowerCase(), password });
  if (error) return { error: t.badLogin };
  const { error: e2 } = await supabase.rpc("partner_accept_invite", { p_hash: hash });
  if (e2) {
    await supabase.auth.signOut();
    return { error: e2.message.replace(/^.*?:\s*/, "") };
  }
  redirect(after(info));
}

/** Already signed in as the invited email: just finish. */
export async function partnerJoinFinish(_prev: PFormState, form: FormData): Promise<PFormState> {
  const { supabase, hash, info } = await lookup(clean(form.get("token"), 200));
  if (!info) return { error: pdict(await adcLang()).inviteGone };
  const { error } = await supabase.rpc("partner_accept_invite", { p_hash: hash });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  redirect(after(info));
}
