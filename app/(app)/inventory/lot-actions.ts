"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { can, HUB_LOCKED_MSG, hubAllows } from "@/lib/access";
import { kickSync } from "@/lib/inventory/sync";
import { emailAdminsLotFix } from "@/lib/inventory/lot-notify";

// Inventory > Change lots (0115): drums of a lot to another product, and a lot's dates, without the spreadsheet.

export type LotRes = { ok: true; msg: string } | { ok: false; error: string };
const clean = (m: string) =>
  /inventory_lot_(fix|decide)|lot_fixer/i.test(m) && /does not exist|schema cache|function/i.test(m)
    ? "Foam lots needs database update 0116 first (Supabase > SQL Editor)."
    : /inventory_lot_(switch|dates)|function .* does not exist|exp_set/i.test(m)
      ? "Change lots needs database update 0115 first (Supabase > SQL Editor)."
      : m.replace(/^.*?ERROR:\s*/, "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function gate(lot: number) {
  const s = await getSession();
  if (!s?.profile) return { error: "Sign in again." } as const;
  if (!(s.profile.role === "admin" || can(s.profile, "item_variance"))) return { error: "Only admins (or people with the Item variance box) can change lots." } as const;
  const { data } = await s.supabase.from("inventory_lots").select("branch_id").eq("id", lot).maybeSingle<{ branch_id: string }>();
  if (!data) return { error: "That lot isn't there any more." } as const;
  if (!hubAllows(s.profile, data.branch_id)) return { error: HUB_LOCKED_MSG } as const;
  return { s, branch: data.branch_id } as const;
}
function done(branch: string, msg: string): LotRes {
  kickSync(branch, "lot change");
  revalidatePath("/inventory/lots");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/holds");
  revalidatePath("/order");
  return { ok: true, msg };
}

/** Move some of a lot's drums to another product (same lot #). */
export async function switchLot(input: { lot: number; qty: string; product: string; note: string }): Promise<LotRes> {
  const lot = Number(input.lot);
  if (!Number.isInteger(lot)) return { ok: false, error: "Pick a lot." };
  const qty = Number(String(input.qty).replace(/,/g, "").trim());
  if (!(qty > 0)) return { ok: false, error: "Type how many drums to change." };
  if (!/^[0-9a-f-]{36}$/i.test(input.product)) return { ok: false, error: "Pick the product the drums are changing to." };
  const g = await gate(lot);
  if ("error" in g) return { ok: false, error: g.error ?? "Not allowed." };
  const { data, error } = await g.s.supabase.rpc("inventory_lot_switch", { p_lot: lot, p_qty: qty, p_product: input.product, p_note: String(input.note ?? "").slice(0, 300) });
  if (error) return { ok: false, error: clean(error.message) };
  return done(g.branch, String(data));
}

/** Fix a lot's expiration and/or made-on date (every row of that lot # at the location). */
export async function fixLotDates(input: { lot: number; exp: string; mfg: string; note: string }): Promise<LotRes> {
  const lot = Number(input.lot);
  if (!Number.isInteger(lot)) return { ok: false, error: "Pick a lot." };
  const exp = DATE.test(input.exp) ? input.exp : null;
  const mfg = DATE.test(input.mfg) ? input.mfg : null;
  if (!exp && !mfg) return { ok: false, error: "Type the right date." };
  const g = await gate(lot);
  if ("error" in g) return { ok: false, error: g.error ?? "Not allowed." };
  const { data, error } = await g.s.supabase.rpc("inventory_lot_dates", { p_lot: lot, p_exp: exp, p_mfg: mfg, p_note: String(input.note ?? "").slice(0, 300) });
  if (error) return { ok: false, error: clean(error.message) };
  return done(g.branch, String(data));
}

/** Fix a lot's count: what's really there, or drums damaged / used here. Over 2 drums from the warehouse waits for an admin. */
export async function fixLot(input: { lot: number; reason: "count" | "damaged" | "used"; qty: string; note: string }): Promise<LotRes & { waiting?: boolean }> {
  const lot = Number(input.lot);
  if (!Number.isInteger(lot)) return { ok: false, error: "Pick a lot." };
  const qty = Number(String(input.qty).replace(/,/g, "").trim());
  if (String(input.qty).trim() === "" || !(qty >= 0)) return { ok: false, error: input.reason === "count" ? "Type how many drums are there." : "Type how many drums." };
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const { data, error } = await s.supabase.rpc("inventory_lot_fix", { p_lot: lot, p_reason: input.reason, p_qty: qty, p_note: String(input.note ?? "").slice(0, 300) });
  if (error) return { ok: false, error: clean(error.message) };
  const r = data as { status: "done" | "waiting"; id: number; msg: string };
  const { data: row } = await s.supabase.from("inventory_lots").select("branch_id").eq("id", lot).maybeSingle<{ branch_id: string }>();
  if (r.status === "waiting") {
    const sent = await emailAdminsLotFix(s.supabase, r.id).catch(() => ({ status: "failed" as const }));
    revalidatePath("/inventory/lots");
    return { ok: true, waiting: true, msg: `${r.msg}${sent.status === "sent" ? " The admins were emailed." : ""}` };
  }
  return done(row?.branch_id ?? "", r.msg);
}

/** Admins: OK or turn down a lot fix that's waiting. */
export async function decideLotFix(input: { id: number; ok: boolean; note: string }): Promise<LotRes> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  const { data: c } = await s.supabase.from("inventory_lot_changes").select("branch_id").eq("id", input.id).maybeSingle<{ branch_id: string }>();
  const { data, error } = await s.supabase.rpc("inventory_lot_decide", { p_change: input.id, p_ok: input.ok, p_note: String(input.note ?? "").slice(0, 300) });
  if (error) return { ok: false, error: clean(error.message) };
  if (!input.ok) {
    revalidatePath("/inventory/lots");
    return { ok: true, msg: String(data) };
  }
  return done(c?.branch_id ?? "", String(data));
}
