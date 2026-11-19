"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, canEmailCustomers } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { hashToken } from "@/lib/invites";
import { getPartner, orderNo, partnerMe } from "@/lib/partner-store";
import { partnerInviteEmail, partnerShippedEmail } from "@/lib/partner-email";

// The store owner's desk: price sheet, orders, customers, store look. Only the owner can change anything
// (the database checks too). AMBIT's partner viewer can look but every action here says no.

export type DeskResult = { ok: true; message?: string; id?: string; link?: string } | { ok: false; error: string };

const NOT_OWNER: DeskResult = { ok: false, error: "Only the store owner can change this." };
const clean = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const money = (v: unknown, dp = 2): number | null => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return NaN;
  return Math.round(n * 10 ** dp) / 10 ** dp;
};
const msg = (e: { message: string }) => e.message.replace(/^.*?:\s*/, "") || "That didn't save. Please try again.";

async function owner(slug: string) {
  const me = await partnerMe(slug);
  if (me.kind !== "owner") return null;
  return { me, supabase: await createClient() };
}

// ------------------------------------------------------------------ price sheet

export type ItemField = "cost" | "price" | "qty_on_hand";

/** One box on the price sheet (purchase price, sell price, qty on hand), saved as soon as they leave it. */
export async function saveItemField(slug: string, id: string, field: ItemField, value: string): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  if (!["cost", "price", "qty_on_hand"].includes(field)) return { ok: false, error: "Unknown box." };
  const v = money(value, field === "cost" ? 4 : 2);
  if (Number.isNaN(v)) return { ok: false, error: "Type a number, like 12.50." };
  const { error } = await o.supabase.from("partner_items").update({ [field]: v, updated_at: new Date().toISOString() }).eq("id", id).eq("partner_id", slug);
  if (error) return { ok: false, error: msg(error) };
  return { ok: true };
}

export type ItemInput = {
  id?: string | null;
  sku: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  cost: string;
  price: string;
  qty_on_hand: string;
  per_customer: boolean;
  image_url: string | null;
};

/** Add an item, or change one (the edit window). */
export async function saveItem(slug: string, i: ItemInput): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  const sku = clean(i.sku, 40);
  const name = clean(i.name, 200);
  if (!sku) return { ok: false, error: "Type the part number (SKU)." };
  if (name.length < 2) return { ok: false, error: "Type the item's name." };
  const cost = money(i.cost, 4);
  const price = money(i.price, 2);
  const qty = money(i.qty_on_hand, 2);
  if ([cost, price, qty].some((x) => Number.isNaN(x))) return { ok: false, error: "Prices and qty must be numbers, like 12.50." };
  const img = i.image_url ? clean(i.image_url, 500) : null;
  if (img && !/^(https:\/\/|\/partners\/)/.test(img) && !img.startsWith("http://127.0.0.1")) return { ok: false, error: "That photo address doesn't look right." };
  const row = {
    partner_id: slug,
    sku,
    name,
    description: clean(i.description, 4000) || null,
    category: clean(i.category, 80) || null,
    unit: clean(i.unit, 30) || "each",
    cost,
    price: i.per_customer ? null : price,
    qty_on_hand: qty,
    per_customer: Boolean(i.per_customer),
    basis: i.per_customer ? "lb" : "unit",
    image_url: img,
    updated_at: new Date().toISOString(),
  };
  if (i.id) {
    const { error } = await o.supabase.from("partner_items").update(row).eq("id", i.id).eq("partner_id", slug);
    if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? `Another item already uses part number ${sku}.` : msg(error) };
    revalidatePath(`/store/${slug}`, "layout");
    return { ok: true, id: i.id };
  }
  const { data: last } = await o.supabase.from("partner_items").select("sort").eq("partner_id", slug).order("sort", { ascending: false }).limit(1).maybeSingle<{ sort: number }>();
  const { data, error } = await o.supabase.from("partner_items").insert({ ...row, sort: (last?.sort ?? 0) + 1 }).select("id").single<{ id: string }>();
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? `Part number ${sku} is already on your sheet (it may be under Removed).` : msg(error) };
  revalidatePath(`/store/${slug}`, "layout");
  return { ok: true, id: data.id };
}

/** Take an item off the sheet and the store (it can be brought back from Removed). */
export async function setItemActive(slug: string, id: string, active: boolean): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  const { error } = await o.supabase.from("partner_items").update({ active, updated_at: new Date().toISOString() }).eq("id", id).eq("partner_id", slug);
  if (error) return { ok: false, error: msg(error) };
  revalidatePath(`/store/${slug}`, "layout");
  return { ok: true };
}

export async function applyMarkup(slug: string, pct: number, onlyEmpty: boolean): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  const { data, error } = await o.supabase.rpc("partner_apply_markup", { p_partner: slug, p_pct: pct, p_only_empty: onlyEmpty });
  if (error) return { ok: false, error: msg(error) };
  if (!data) return { ok: true, message: onlyEmpty ? "Nothing to set: every item that has a purchase price already has a sell price." : "Nothing to set: type purchase prices first." };
  return { ok: true, message: `Set ${data} sell ${data === 1 ? "price" : "prices"}.` };
}

// ------------------------------------------------------------------ orders

export async function setOrderStatus(slug: string, id: number, status: "new" | "shipped" | "done" | "cancelled", tracking: string, notify: boolean): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  if (!["new", "shipped", "done", "cancelled"].includes(status)) return { ok: false, error: "Unknown status." };
  const tr = clean(tracking, 80) || null;
  const { data, error } = await o.supabase
    .from("partner_orders")
    .update({ status, tracking: tr, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("partner_id", slug)
    .select("id, name, email, lang")
    .single<{ id: number; name: string; email: string; lang: string }>();
  if (error) return { ok: false, error: msg(error) };
  if (status === "shipped" && notify && canEmailCustomers()) {
    const p = await getPartner(slug);
    if (p) {
      const no = orderNo(p.short, data.id);
      const es = data.lang === "es";
      await sendEmail({
        to: [data.email],
        fromName: p.name,
        replyTo: p.email ?? undefined,
        subject: es ? `Su pedido ${no} va en camino` : `Your order ${no} shipped`,
        html: partnerShippedEmail(p, await currentOrigin(), no, data.name, tr, es ? "es" : "en"),
        text: es ? `Su pedido ${no} va en camino.${tr ? ` Rastreo: ${tr}.` : ""}` : `Your order ${no} shipped.${tr ? ` Tracking: ${tr}.` : ""}`,
      });
      return { ok: true, message: `Marked shipped and emailed ${data.email}.` };
    }
  }
  return { ok: true };
}

// ------------------------------------------------------------------ customers

export type CustomerInput = {
  id?: string | null;
  company: string;
  contact: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  terms: string;
  off_pct: string;
  notes: string;
  active: boolean;
};

export async function saveCustomer(slug: string, c: CustomerInput): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  const company = clean(c.company, 160);
  if (company.length < 2) return { ok: false, error: "Type the company name." };
  const email = clean(c.email, 160).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  const off = money(c.off_pct, 2) ?? 0;
  if (Number.isNaN(off) || off > 90) return { ok: false, error: "% off must be a number from 0 to 90." };
  const row = {
    partner_id: slug,
    company,
    contact: clean(c.contact, 120) || null,
    email: email || null,
    phone: clean(c.phone, 40) || null,
    street: clean(c.street, 160) || null,
    city: clean(c.city, 80) || null,
    state: clean(c.state, 2).toUpperCase() || null,
    zip: clean(c.zip, 10) || null,
    terms: clean(c.terms, 40) || null,
    off_pct: off,
    notes: clean(c.notes, 2000) || null,
    active: c.active !== false,
    updated_at: new Date().toISOString(),
  };
  if (c.id) {
    const { error } = await o.supabase.from("partner_customers").update(row).eq("id", c.id).eq("partner_id", slug);
    if (error) return { ok: false, error: msg(error) };
    return { ok: true, id: c.id };
  }
  const { data, error } = await o.supabase.from("partner_customers").insert(row).select("id").single<{ id: string }>();
  if (error) return { ok: false, error: msg(error) };
  return { ok: true, id: data.id };
}

/** A customer's own price on one item (foam: per lb). Empty clears it. */
export async function setCustomerPrice(slug: string, customerId: string, itemId: string, value: string): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  const v = money(value, 4);
  if (Number.isNaN(v)) return { ok: false, error: "Type a number, like 12.50." };
  const { data: c } = await o.supabase.from("partner_customers").select("id").eq("id", customerId).eq("partner_id", slug).maybeSingle();
  if (!c) return { ok: false, error: "Pick the customer again." };
  if (v === null) {
    const { error } = await o.supabase.from("partner_customer_prices").delete().eq("customer_id", customerId).eq("item_id", itemId);
    if (error) return { ok: false, error: msg(error) };
    return { ok: true };
  }
  const { error } = await o.supabase.from("partner_customer_prices").upsert({ customer_id: customerId, item_id: itemId, price: v, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: msg(error) };
  return { ok: true };
}

/** Email a customer (or, from AMBIT, the store owner) a link to make their login. */
export async function sendPartnerInvite(slug: string, role: "owner" | "customer", customerId: string | null, emailIn: string): Promise<DeskResult> {
  const me = await partnerMe(slug);
  if (role === "customer" && me.kind !== "owner") return NOT_OWNER;
  if (role === "owner" && me.kind !== "viewer") return { ok: false, error: "Only AMBIT can invite the store owner." };
  const p = await getPartner(slug);
  if (!p) return { ok: false, error: "Store not found." };
  const supabase = await createClient();
  let name: string | null = null;
  let company: string | null = null;
  if (role === "customer") {
    const { data: c } = await supabase.from("partner_customers").select("company, contact").eq("id", customerId ?? "").eq("partner_id", slug).maybeSingle<{ company: string; contact: string | null }>();
    if (!c) return { ok: false, error: "Pick the customer again." };
    name = c.contact;
    company = c.company;
  } else name = p.owner_name;
  const email = clean(emailIn, 160).toLowerCase();
  const token = randomBytes(24).toString("base64url");
  const { error } = await supabase.rpc("partner_create_invite", { p_partner: slug, p_role: role, p_email: email, p_customer: role === "customer" ? customerId : null, p_hash: hashToken(token) });
  if (error) return { ok: false, error: msg(error) };
  const origin = await currentOrigin();
  const link = `${origin}/store/${slug}/join/${token}`;
  const sent = await sendEmail({
    to: [email],
    fromName: role === "owner" ? "AMBIT" : p.name,
    replyTo: role === "owner" ? undefined : p.email ?? undefined,
    subject: role === "owner" ? `Your ${p.name} store is ready` : `Your ${p.name} account`,
    html: partnerInviteEmail(p, origin, link, role, name, company),
    text: `${role === "owner" ? `Your ${p.name} store is ready.` : `You have an account with ${p.name}.`} Make your password here (the link works for 30 days): ${link}`,
  });
  revalidatePath(`/store/${slug}/desk/customers`);
  if (sent.status !== "sent") return { ok: true, message: `The email didn't go out (${sent.status.replace("_", " ")}). Send them this link yourself:`, link };
  return { ok: true, message: `Invite sent to ${email}.` };
}

// ------------------------------------------------------------------ store look and contact info

export type StoreInput = {
  name: string;
  short: string;
  owner_name: string;
  email: string;
  phone: string;
  logo_url: string | null;
  color: string;
  color2: string;
  tagline: string;
  hero_title: string;
  hero_text: string;
  tagline_es: string;
  hero_title_es: string;
  hero_text_es: string;
};

export async function saveStore(slug: string, s: StoreInput): Promise<DeskResult> {
  const o = await owner(slug);
  if (!o) return NOT_OWNER;
  const hex = (c: string, d: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);
  const email = clean(s.email, 160).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  if (clean(s.name, 120).length < 2) return { ok: false, error: "Type the store's name." };
  const logo = s.logo_url ? clean(s.logo_url, 500) : null;
  if (logo && !/^(https:\/\/|\/partners\/)/.test(logo) && !logo.startsWith("http://127.0.0.1")) return { ok: false, error: "That logo address doesn't look right." };
  const { error } = await o.supabase
    .from("partners")
    .update({
      name: clean(s.name, 120),
      short: clean(s.short, 8).toUpperCase() || "STORE",
      owner_name: clean(s.owner_name, 120) || null,
      email: email || null,
      phone: clean(s.phone, 40) || null,
      logo_url: logo,
      color: hex(s.color, "#2d694b"),
      color2: hex(s.color2, "#24563d"),
      tagline: clean(s.tagline, 160) || null,
      hero_title: clean(s.hero_title, 160) || null,
      hero_text: clean(s.hero_text, 400) || null,
      tagline_es: clean(s.tagline_es, 160) || null,
      hero_title_es: clean(s.hero_title_es, 160) || null,
      hero_text_es: clean(s.hero_text_es, 400) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", slug);
  if (error) return { ok: false, error: msg(error) };
  revalidatePath(`/store/${slug}`, "layout");
  return { ok: true, message: "Saved. Your store shows the changes now." };
}
