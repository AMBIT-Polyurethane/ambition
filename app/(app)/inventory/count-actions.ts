"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/access";
import { kickSync } from "@/lib/inventory/sync";

// Spot checks, reconciliations (counts) and expected deliveries. The database checks who may do what.

const BRANCH = /^[a-z]{2,8}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function staff() {
  const s = await getSession();
  if (!s?.profile || (s.profile.role !== "admin" && !can(s.profile, "inventory"))) return null;
  return s;
}

function done(path: string, kind: "msg" | "err", text: string): never {
  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath(path.split("?")[0]);
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
}

/** One counted number (or null to clear it). Saved straight away; a spot check is sent in when it's complete. */
export async function saveCountLine(lineId: number, qty: number | null, note?: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to inventory." };
  if (qty !== null && (!Number.isFinite(qty) || qty < 0 || qty > 1_000_000)) return { ok: false, error: "Type a number (0 or more)." };
  const { data, error } = await s.supabase.rpc("count_line_save", { p_line: lineId, p_qty: qty, p_note: note ?? null });
  if (error) return { ok: false, error: error.message };
  const status = String((data as { status?: string } | null)?.status ?? "open");
  if (status !== "open") revalidatePath("/");
  return { ok: true, status };
}

/** Start (or carry on with) the quarterly inventory reconciliation for a location. */
export async function startReconcile(form: FormData) {
  const s = await staff();
  if (!s) return;
  const branch = String(form.get("branch") ?? "");
  if (!BRANCH.test(branch)) return;
  const { data, error } = await s.supabase.rpc("count_start_reconcile", { p_branch: branch });
  if (error) done(`/inventory?b=${branch}`, "err", error.message);
  redirect(`/inventory/counts/${data}`);
}

/** Send a reconciliation in for an admin to approve. */
export async function submitCount(form: FormData) {
  const s = await staff();
  if (!s) return;
  const id = Number(form.get("id"));
  const { data, error } = await s.supabase.rpc("count_submit", { p_count: id });
  if (error) done(`/inventory/counts/${id}`, "err", error.message);
  done(
    `/inventory/counts/${id}`,
    "msg",
    data === "matched" ? "Sent in. Everything matched what the app had, so nothing needs approving." : "Sent in. An admin will check the differences and approve them.",
  );
}

/** Admin: approve (differences go into stock and onto the spreadsheet) or reject. */
/** Approve a count (the "Approve" button). */
export async function approveCount(form: FormData) {
  return review(form, true);
}

/** Don't approve it: stock stays as it is ("Don't approve"). */
export async function rejectCount(form: FormData) {
  return review(form, false);
}

async function review(form: FormData, approve: boolean) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const id = Number(form.get("id"));
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  const { data: count } = await s.supabase.from("inventory_counts").select("branch_id").eq("id", id).maybeSingle<{ branch_id: string }>();
  const { data, error } = await s.supabase.rpc("count_review", { p_count: id, p_approve: approve, p_note: note || null });
  if (error) done(`/inventory/counts/${id}`, "err", error.message);
  if (approve && count) kickSync(count.branch_id, "count approved");
  done(
    `/inventory/counts/${id}`,
    "msg",
    approve ? `Approved. ${Number(data)} ${Number(data) === 1 ? "difference goes" : "differences go"} onto the spreadsheet in a few seconds.` : "Not approved. Stock wasn't changed.",
  );
}

// ------------------------------------------------------------------ expected deliveries
export type IncomingInput = {
  id: number | null;
  branch: string;
  vendor: string;
  expected: string;
  ref: string;
  note: string;
  lines: { product_id: string; qty: number }[];
};

export async function saveIncoming(input: IncomingInput): Promise<{ ok: false; error: string } | never> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to inventory." };
  if (!BRANCH.test(input.branch)) return { ok: false, error: "Pick the location." };
  if (!DAY.test(input.expected)) return { ok: false, error: "Pick the day it's expected." };
  const { data, error } = await s.supabase.rpc("inbound_save", {
    p_id: input.id,
    p_branch: input.branch,
    p_vendor: input.vendor,
    p_expected: input.expected,
    p_ref: input.ref,
    p_note: input.note,
    p_lines: input.lines.filter((l) => l.product_id && l.qty > 0),
  });
  if (error) return { ok: false, error: error.message };
  done(`/inventory/incoming/${data}`, "msg", input.id ? "Saved." : "Added. It's on the warehouse calendar.");
}

export type ReceiveLine = { id: number; received_qty: number; lot_no?: string; mfg?: string; exp?: string };

export async function receiveIncoming(id: number, lines: ReceiveLine[]): Promise<{ ok: false; error: string } | never> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to inventory." };
  const { data: d } = await s.supabase.from("inbound_deliveries").select("branch_id").eq("id", id).maybeSingle<{ branch_id: string }>();
  const { error } = await s.supabase.rpc("inbound_receive", { p_id: id, p_lines: lines });
  if (error) return { ok: false, error: error.message };
  if (d) kickSync(d.branch_id, "delivery received");
  done(`/inventory/incoming/${id}`, "msg", "Received. It goes onto the spreadsheet in a few seconds.");
}

export async function cancelIncoming(form: FormData) {
  const s = await staff();
  if (!s) return;
  const id = Number(form.get("id"));
  const { error } = await s.supabase.rpc("inbound_cancel", { p_id: id });
  if (error) done(`/inventory/incoming/${id}`, "err", error.message);
  done(`/inventory/incoming`, "msg", "Delivery cancelled.");
}
