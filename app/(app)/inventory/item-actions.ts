"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { kickSync } from "@/lib/inventory/sync";

// Stock (0116): an item's reorder point, Max, vendor and lead time, and adding an item to a location.
// Both go onto the location's COUNT SHEET within 2 minutes.

export type ItemRes = { ok: true; msg: string } | { ok: false; error: string };
const clean = (m: string) =>
  /inventory_item_(settings|add)|max_app|supply_app|add_to_sheet/i.test(m) && /does not exist|schema cache|function|column/i.test(m)
    ? "This needs database update 0116 first (Supabase > SQL Editor)."
    : m.replace(/^.*?ERROR:\s*/, "");
const num = (v: string) => {
  const t = String(v ?? "").replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const BRANCH = /^[a-z]{2,8}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export type ItemInput = { branch: string; product: string; onHand?: string; rop: string; max: string; vendor: string; lead: string };

function parse(i: ItemInput): { ok: false; error: string } | { ok: true; rop: number | null; max: number | null; lead: number | null; onHand: number | null } {
  if (!BRANCH.test(i.branch) || !UUID.test(i.product)) return { ok: false, error: "Pick an item." };
  const rop = num(i.rop), max = num(i.max), lead = num(i.lead), onHand = num(i.onHand ?? "");
  if ([rop, max, lead, onHand].some((x) => Number.isNaN(x))) return { ok: false, error: "Numbers only." };
  if (lead !== null && !Number.isInteger(lead)) return { ok: false, error: "Lead time is a whole number of business days." };
  return { ok: true, rop, max, lead, onHand };
}
function done(branch: string, msg: string): ItemRes {
  kickSync(branch, "item settings");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/reorders");
  return { ok: true, msg };
}

export async function saveItemSettings(i: ItemInput): Promise<ItemRes> {
  const p = parse(i);
  if (!p.ok) return p;
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const { data, error } = await s.supabase.rpc("inventory_item_settings", { p_branch: i.branch, p_product: i.product, p_rop: p.rop, p_max: p.max, p_vendor: i.vendor ?? "", p_lead: p.lead });
  if (error) return { ok: false, error: clean(error.message) };
  return done(i.branch, String(data));
}

export async function addStockItem(i: ItemInput): Promise<ItemRes> {
  const p = parse(i);
  if (!p.ok) return p;
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const { data, error } = await s.supabase.rpc("inventory_item_add", { p_branch: i.branch, p_product: i.product, p_on_hand: p.onHand, p_rop: p.rop, p_max: p.max, p_vendor: i.vendor ?? "", p_lead: p.lead });
  if (error) return { ok: false, error: clean(error.message) };
  return done(i.branch, String(data));
}
