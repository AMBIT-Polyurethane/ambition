import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PItem } from "@/components/partner/ui";

// A distributor's own store on AMBIT Intelligence (Contractors Foam Supply first). Everything here goes through the
// signed-in person's own access, so the database decides who sees what (supabase/migrations/0096).

export type PartnerRow = {
  id: string;
  name: string;
  short: string;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
  color: string;
  color2: string;
  tagline: string | null;
  hero_title: string | null;
  hero_text: string | null;
  tagline_es: string | null;
  hero_title_es: string | null;
  hero_text_es: string | null;
  active: boolean;
};

/** One item as a shopper sees it: no purchase price, no other customer's price. */
export type PCatItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  image: string | null;
  /** The store price (null: call for price, or priced per customer). */
  price: number | null;
  per_customer: boolean;
  basis: "unit" | "lb";
  in_stock: boolean | null;
  /** This signed-in customer's price (their special price, or the store price less their % off). */
  my_price: number | null;
  sort: number;
};

export type PartnerCustomer = {
  id: string;
  partner_id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  terms: string | null;
  off_pct: number;
  notes: string | null;
  user_id: string | null;
  invited_at: string | null;
  active: boolean;
};

/** Who is looking at a partner's store. */
export type PartnerMe =
  | { kind: "guest" }
  | { kind: "owner"; id: string; email: string; name: string | null }
  | { kind: "customer"; id: string; email: string; name: string | null; customer: PartnerCustomer }
  /** AMBIT's partner viewer (Jeremiah): may look at the desk, can't change anything. */
  | { kind: "viewer"; id: string; email: string; name: string | null }
  /** Signed in, but not as one of this store's people (AMBIT staff, an AMBIT customer, another store). */
  | { kind: "other"; id: string; email: string; name: string | null; partnerId: string | null };

export const getPartner = cache(async (slug: string): Promise<PartnerRow | null> => {
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("partners").select("*").eq("id", slug).maybeSingle();
  return (data as PartnerRow | null) ?? null;
});

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export const partnerCatalog = cache(async (slug: string): Promise<PCatItem[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partner_catalog", { p_partner: slug });
  if (error) return [];
  return ((data ?? []) as (Omit<PCatItem, "image"> & { image_url: string | null })[])
    .map(({ image_url, ...i }) => ({ ...i, image: image_url, price: num(i.price), my_price: num(i.my_price) }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
});

export const partnerMe = cache(async (slug: string): Promise<PartnerMe> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return { kind: "guest" };
  const { data: p } = await supabase
    .from("profiles")
    .select("id, email, full_name, status, partner_id, partner_role, partner_customer_id")
    .eq("id", sub)
    .maybeSingle<{ id: string; email: string; full_name: string | null; status: string; partner_id: string | null; partner_role: string | null; partner_customer_id: string | null }>();
  if (!p) return { kind: "guest" };
  const base = { id: p.id, email: p.email, name: p.full_name };
  if (p.status === "active" && p.partner_id === slug && p.partner_role === "owner") return { kind: "owner", ...base };
  if (p.status === "active" && p.partner_id === slug && p.partner_role === "customer" && p.partner_customer_id) {
    const { data: c } = await supabase.from("partner_customers").select("*").eq("id", p.partner_customer_id).maybeSingle();
    if (c) return { kind: "customer", ...base, customer: { ...(c as PartnerCustomer), off_pct: Number((c as PartnerCustomer).off_pct) } };
  }
  if (!p.partner_id) {
    const { data: v } = await supabase.rpc("can_view_partner", { p: slug });
    if (v === true) return { kind: "viewer", ...base };
  }
  return { kind: "other", ...base, partnerId: p.partner_id };
});

/** Categories in store order, with how many items each has and a photo. */
export function partnerCats(items: PCatItem[]) {
  const out: { id: string; name: string; n: number; image: string | null }[] = [];
  for (const i of items) {
    const name = i.category?.trim() || "Other";
    const id = catId(name);
    const c = out.find((x) => x.id === id);
    if (c) {
      c.n++;
      if (!c.image && i.image) c.image = i.image;
    } else out.push({ id, name, n: 1, image: i.image });
  }
  return out;
}
export const catId = (name: string | null) => (name?.trim() || "Other").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** What a shopper's page sends to the browser (the description stays on the server). */
export const toPItem = (i: PCatItem): PItem => ({
  id: i.id, sku: i.sku, name: i.name, category: i.category, unit: i.unit, image: i.image,
  price: i.price, my_price: i.my_price, per_customer: i.per_customer, basis: i.basis, in_stock: i.in_stock,
});

/** "CFS-1001": the order number the store and its emails show. */
export const orderNo = (short: string, id: number) => `${short}-${1000 + id}`;
