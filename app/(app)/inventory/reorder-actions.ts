"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { hubAllows } from "@/lib/access";
import { kickSync } from "@/lib/inventory/sync";
import { canRequestReorder, canSetRop, reorderRef, sendReorderRequest, type ReorderLine } from "@/lib/inventory/reorder";

// Reorder points and reorder requests (0064).

const BRANCH = /^[a-z]{2,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS_0064 = "Reorder points and requests need the 0064 database update first. Ask Jeremiah to run it.";
const missing = (m: string) => /inventory_set_rop|reorder_request|function|schema cache|does not exist/i.test(m);

export type Result = { ok: true; n?: number; id?: number; ref?: string; note?: string } | { ok: false; error: string };

/** Saves reorder points typed (or filled in from suggestions) on the Stock screen. */
export async function saveReorderPoints(branch: string, items: { product: string; rop: number | null }[]): Promise<Result> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  if (!BRANCH.test(branch)) return { ok: false, error: "Pick a location." };
  if (!canSetRop(s.profile, branch) || !hubAllows(s.profile, branch)) return { ok: false, error: "Admins, CRMs and this location's warehouse manager set reorder points." };
  const clean = items
    .filter((i) => UUID.test(i.product))
    .map((i) => ({ product: i.product, rop: i.rop === null || i.rop === undefined || !Number.isFinite(Number(i.rop)) ? null : Math.max(0, Math.round(Number(i.rop) * 100) / 100) }));
  if (!clean.length) return { ok: false, error: "Nothing changed." };
  let n = 0;
  for (let k = 0; k < clean.length; k += 400) {
    const { data, error } = await s.supabase.rpc("inventory_set_rop", { p_branch: branch, p_items: clean.slice(k, k + 400) });
    if (error) return { ok: false, error: missing(error.message) ? NEEDS_0064 : error.message };
    n += Number(data ?? 0);
  }
  kickSync(branch, "reorder points");
  revalidatePath("/inventory", "layout");
  return { ok: true, n };
}

/** Admins and CRMs: the checked items go to purchasing (Al Rearick) as a reorder request. */
export async function requestReorder(branch: string, note: string, lines: { product: string; qty: number }[]): Promise<Result> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "Sign in again." };
  if (!canRequestReorder(s.profile)) return { ok: false, error: "Admins and CRMs send reorder requests." };
  if (!BRANCH.test(branch)) return { ok: false, error: "Pick a location." };
  const clean = lines.filter((l) => UUID.test(l.product) && Number(l.qty) > 0).map((l) => ({ product: l.product, qty: Math.round(Number(l.qty) * 100) / 100 }));
  if (!clean.length) return { ok: false, error: "Enter how many of each item to order." };
  const { data, error } = await s.supabase.rpc("reorder_request", { p_branch: branch, p_note: note.trim().slice(0, 1000) || null, p_lines: clean });
  if (error) return { ok: false, error: missing(error.message) ? NEEDS_0064 : error.message };
  const id = Number(data);
  const [{ data: rows }, { data: br }] = await Promise.all([
    s.supabase.from("reorder_request_lines").select("sku, name, unit, qty, on_hand, available, reorder_point, sold_60").eq("request_id", id).order("id"),
    s.supabase.from("branches").select("name, state").eq("id", branch).maybeSingle(),
  ]);
  const name = s.profile.full_name || s.profile.email;
  const sent = await sendReorderRequest(s.supabase, {
    id,
    branchName: br ? `${br.name}, ${br.state}` : branch.toUpperCase(),
    by: name,
    byEmail: s.profile.email,
    note: note.trim() || null,
    lines: ((rows ?? []) as ReorderLine[]).map((l) => ({ ...l, qty: Number(l.qty) })),
  }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));
  await s.supabase.rpc("reorder_request_email", { p_id: id, p_status: sent.status, p_error: sent.error ?? null });
  revalidatePath("/inventory", "layout");
  return {
    ok: true,
    id,
    ref: reorderRef(id),
    note:
      sent.status === "sent"
        ? "Sent to purchasing."
        : sent.status === "not_configured"
          ? "Saved. Email isn't set up yet, so let purchasing know it's in Reorder requests."
          : `Saved, but the email didn't go out (${sent.error ?? sent.status}).`,
  };
}

function backTo(id: string, kind: "msg" | "err", text: string): never {
  revalidatePath("/inventory", "layout");
  redirect(`/inventory/reorders${id ? `/${id}` : ""}?${kind}=${encodeURIComponent(text)}`);
}

/** Purchasing or an admin: Ordered / Cancelled / back to open. The person who asked can cancel their own. */
export async function setReorderStatus(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!/^\d+$/.test(id) || !["open", "ordered", "cancelled"].includes(status)) return;
  const { error } = await s.supabase.rpc("reorder_request_set", { p_id: Number(id), p_status: status, p_note: String(form.get("note") ?? "").trim().slice(0, 500) || null });
  if (error) backTo(id, "err", error.message);
  backTo(id, "msg", status === "ordered" ? "Marked ordered." : status === "cancelled" ? "Cancelled." : "Open again.");
}

/** Admins: who reorder requests go to. */
export async function savePurchasingContact(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) backTo("", "err", "Type an email address.");
  const { error } = await s.supabase.from("app_settings").upsert({ key: "purchasing", value: { name: name || email, email }, updated_at: new Date().toISOString() });
  if (error) backTo("", "err", error.message);
  backTo("", "msg", `Reorder requests now go to ${name || email}.`);
}
