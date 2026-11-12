"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { docFromJson } from "@/lib/order-doc/load";
import { sendApprovedOrderByLink, sendChangeRequestNotice } from "@/lib/order-send";

export type LinkResult = { ok: true } | { ok: false; error: string };

/** The customer approves from the emailed link (no sign-in needed). */
export async function approveByLink(token: string, name: string): Promise<LinkResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_order_by_link", { p_token: token, p_name: String(name ?? "").slice(0, 120) });
  if (error) return { ok: false, error: error.message };
  const doc = docFromJson(data);
  const already = Boolean((data as { already?: boolean } | null)?.already);
  if (doc && !already) await sendApprovedOrderByLink(supabase, token, doc);
  revalidatePath(`/approve/${token}`);
  return { ok: true };
}

/** The customer asks for changes instead of approving. Their AMBIT rep gets an email. */
export async function requestChangesByLink(token: string, note: string): Promise<LinkResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_order_changes_by_link", { p_token: token, p_note: String(note ?? "").slice(0, 2000) });
  if (error) return { ok: false, error: error.message };
  const doc = docFromJson(data);
  if (doc) await sendChangeRequestNotice(doc);
  revalidatePath(`/approve/${token}`);
  return { ok: true };
}

/** The customer adds items from the approval email's "Need anything else?" (0065), before approving. */
export async function addItemsByLink(token: string, items: { product_id: string; qty: number }[]): Promise<LinkResult> {
  const supabase = await createClient();
  const clean = items.filter((i) => /^[0-9a-f-]{36}$/i.test(i.product_id) && Number(i.qty) > 0).slice(0, 60).map((i) => ({ product_id: i.product_id, qty: Math.min(1000, Number(i.qty)) }));
  if (!clean.length) return { ok: false, error: "Pick at least one item." };
  const { error } = await supabase.rpc("order_add_items_by_link", { p_token: token, p_items: clean });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/approve/${token}`);
  return { ok: true };
}
