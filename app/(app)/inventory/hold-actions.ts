"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canHold } from "@/lib/inventory/holds";
import { HUB_LOCKED_MSG, hubLock } from "@/lib/access";

// Holding a lot for a customer (0071): place, change the date, release.

const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, "");
const needs = (m: string) => (/inventory_hold_|function .* does not exist/i.test(m) ? "Holds need the 0071 database update first (Supabase > SQL Editor)." : clean(m));

function back(branch: string, kind: "msg" | "err", text: string, extra: Record<string, string> = {}): never {
  revalidatePath("/inventory/holds");
  revalidatePath("/inventory/stock");
  const q = new URLSearchParams({ ...(branch ? { b: branch } : {}), ...extra, [kind]: text });
  redirect(`/inventory/holds?${q.toString()}`);
}

/** Warehouse managers look at other locations but only hold or release at their own. */
async function offLock(s: NonNullable<Awaited<ReturnType<typeof getSession>>>, table: "inventory_lots" | "inventory_holds", id: number): Promise<boolean> {
  const lock = hubLock(s.profile);
  if (lock === null) return false;
  const { data } = await s.supabase.from(table).select("branch_id").eq("id", id).maybeSingle<{ branch_id: string }>();
  return !data || !lock || data.branch_id !== lock;
}

export async function placeHold(form: FormData) {
  const s = await getSession();
  const branch = String(form.get("branch") ?? "");
  if (!s?.profile || !canHold(s.profile)) back(branch, "err", "Only admins and the order desk can hold material for a customer.");
  const lot = Number(form.get("lot"));
  const company = String(form.get("company") ?? "");
  const until = String(form.get("until") ?? "");
  const all = Number(form.get("free") ?? 0);
  const typed = String(form.get("qty") ?? "").trim();
  const qty = typed ? Number(typed) : all;
  const keep = { lot: String(lot || ""), c: company };
  if (!lot) back(branch, "err", "Pick the lot to hold.", keep);
  if (await offLock(s!, "inventory_lots", lot)) back(branch, "err", HUB_LOCKED_MSG, keep);
  if (!company) back(branch, "err", "Pick the customer.", keep);
  if (!Number.isFinite(qty) || qty <= 0) back(branch, "err", "Say how many to hold (a number).", keep);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) back(branch, "err", "Pick the date the hold runs until.", keep);
  const { error } = await s!.supabase.rpc("inventory_hold_place", {
    p_lot: lot,
    p_company: company,
    p_qty: Math.round(qty * 100) / 100,
    p_until: until,
    p_note: String(form.get("note") ?? "").slice(0, 300) || null,
  });
  if (error) back(branch, "err", needs(error.message), keep);
  back(branch, "msg", "Held. Nobody else's orders get those drums now, and the customer's orders take them first. FOAM LOTS shows it after the next sync.");
}

export async function releaseHold(form: FormData) {
  const s = await getSession();
  const branch = String(form.get("branch") ?? "");
  if (!s?.profile || !canHold(s.profile)) back(branch, "err", "Only admins and the order desk can release a hold.");
  if (await offLock(s!, "inventory_holds", Number(form.get("id")))) back(branch, "err", HUB_LOCKED_MSG);
  const { error } = await s!.supabase.rpc("inventory_hold_release", { p_hold: Number(form.get("id")), p_note: String(form.get("note") ?? "").slice(0, 300) || null });
  if (error) back(branch, "err", needs(error.message));
  back(branch, "msg", "Released. Those drums are available to everyone again.");
}

export async function extendHold(form: FormData) {
  const s = await getSession();
  const branch = String(form.get("branch") ?? "");
  if (!s?.profile || !canHold(s.profile)) back(branch, "err", "Only admins and the order desk can change a hold.");
  if (await offLock(s!, "inventory_holds", Number(form.get("id")))) back(branch, "err", HUB_LOCKED_MSG);
  const { error } = await s!.supabase.rpc("inventory_hold_extend", { p_hold: Number(form.get("id")), p_until: String(form.get("until") ?? "") });
  if (error) back(branch, "err", needs(error.message));
  back(branch, "msg", "The hold's date was changed.");
}
