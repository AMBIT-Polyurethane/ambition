"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { HUB_LOCKED_MSG, can, hubAllows } from "@/lib/access";
import { claudeReady, friendlyClaudeError } from "@/lib/ai/claude";
import { stockItems } from "@/lib/incoming";
import { readBol, type BolRead } from "@/lib/inventory/bol";
import { kickSync } from "@/lib/inventory/sync";
import { emailAdminsReportWaiting, emailReceiverSentBack } from "@/lib/receiving-notify";

// Inventory Hub: Receiving Reports (with the BOL read by AI) and transfers between locations.

async function receiver() {
  const s = await getSession();
  if (!s?.profile || !(can(s.profile, "receiving") || can(s.profile, "inventory"))) return null;
  return s;
}

const FILE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;

/** Reads the BOL photos / PDF (already uploaded to inventory-files under the location) into a draft report. */
export async function readBolAction(input: { branch: string; paths: string[] }): Promise<{ ok: true; read: BolRead } | { ok: false; error: string }> {
  const s = await receiver();
  if (!s) return { ok: false, error: "You don't have access to receiving." };
  const branch = String(input.branch ?? "");
  if (!hubAllows(s.profile, branch)) return { ok: false, error: HUB_LOCKED_MSG };
  const paths = (input.paths ?? []).filter((p) => typeof p === "string" && FILE.test(p) && p.startsWith(`${branch}/`)).slice(0, 4);
  if (!paths.length) return { ok: false, error: "Add a photo or PDF of the BOL first." };
  if (!claudeReady()) return { ok: false, error: "Reading BOLs needs the Claude connection (ANTHROPIC_API_KEY in Vercel). Fill the report in by hand for now." };
  const { data: b } = await s.supabase.from("branches").select("name, state").eq("id", branch).maybeSingle<{ name: string; state: string }>();
  if (!b) return { ok: false, error: "Pick the location." };
  const items = await stockItems(s.supabase, branch);
  try {
    const read = await readBol({ supabase: s.supabase, branchName: `${b.name}, ${b.state}`, items, paths });
    return { ok: true, read };
  } catch (e) {
    console.error("BOL read failed", e);
    return { ok: false, error: e instanceof Error && /open the file/.test(e.message) ? e.message : friendlyClaudeError(e) };
  }
}

export type ReportLine = { id?: number | null; product_id: string; qty: number; received_qty: number; damaged_qty?: number; lot_no?: string; mfg?: string; exp?: string; note?: string };
export type ReportInput = {
  id: number | null;
  branch: string;
  head: { vendor: string; bol_no: string; po_no: string; carrier: string; received_on: string; note: string; files: { path: string; name: string }[]; read_by_ai: boolean; ai_cost_cents: number };
  lines: ReportLine[];
};

/**
 * Receive: the report is saved with the BOL. An admin's report goes straight into stock (FOAM LOTS / RECEIVED LOTS);
 * anyone else's waits for an admin to approve it, and the admins are emailed.
 */
export async function receiveReport(input: ReportInput): Promise<{ ok: false; error: string } | never> {
  const s = await receiver();
  if (!s) return { ok: false, error: "You don't have access to receiving." };
  if (!hubAllows(s.profile, input.branch)) return { ok: false, error: HUB_LOCKED_MSG };
  const files = (input.head.files ?? []).filter((f) => FILE.test(f.path)).map((f) => ({ path: f.path, name: String(f.name ?? "").slice(0, 120) }));
  const { data, error } = await s.supabase.rpc("inbound_receive_report", {
    p_id: input.id,
    p_branch: input.branch,
    p_head: { ...input.head, files },
    p_lines: input.lines.map((l) => ({
      id: l.id ?? null,
      product_id: l.product_id,
      qty: l.qty,
      received_qty: l.received_qty,
      damaged_qty: l.damaged_qty ?? 0,
      lot_no: l.lot_no ?? "",
      mfg: l.mfg ?? "",
      exp: l.exp ?? "",
      note: l.note ?? "",
    })),
  });
  if (error) return { ok: false, error: error.message };
  const id = Number(data);
  const { data: now } = await s.supabase.from("inbound_deliveries").select("status").eq("id", id).maybeSingle<{ status: string }>();
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  if (now?.status === "submitted") {
    const sent = await emailAdminsReportWaiting(s.supabase, id);
    redirect(
      `/inventory/incoming/${id}?msg=${encodeURIComponent(
        `Sent to an admin for approval${sent.status === "sent" ? " (they were emailed)" : ""}. Stock and the spreadsheet update once it's approved.`,
      )}`,
    );
  }
  kickSync(input.branch, "receiving report");
  redirect(`/inventory/incoming/${id}?msg=${encodeURIComponent("Received. Stock updated; the spreadsheet catches up within 2 minutes.")}`);
}

/** Admin: approve a Receiving Report as it was sent. Stock and the spreadsheet update. */
export async function approveReceiving(form: FormData) {
  const s = await getSession();
  const id = Number(form.get("id"));
  if (!s?.profile || s.profile.role !== "admin" || !Number.isFinite(id)) return;
  const { error } = await s.supabase.rpc("inbound_approve", { p_id: id });
  const { data: d } = await s.supabase.from("inbound_deliveries").select("branch_id").eq("id", id).maybeSingle<{ branch_id: string }>();
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  if (error) redirect(`/inventory/incoming/${id}?err=${encodeURIComponent(error.message)}`);
  if (d) kickSync(d.branch_id, "receiving report approved");
  redirect(`/inventory/incoming/${id}?msg=${encodeURIComponent("Approved. Stock updated; the spreadsheet catches up within 2 minutes.")}`);
}

/** Admin: send a Receiving Report back to whoever received it, with what to fix. */
export async function sendBackReceiving(form: FormData) {
  const s = await getSession();
  const id = Number(form.get("id"));
  const note = String(form.get("note") ?? "").trim();
  if (!s?.profile || s.profile.role !== "admin" || !Number.isFinite(id)) return;
  const { error } = await s.supabase.rpc("inbound_send_back", { p_id: id, p_note: note });
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  if (error) redirect(`/inventory/incoming/${id}?err=${encodeURIComponent(error.message)}`);
  const sent = await emailReceiverSentBack(s.supabase, id);
  redirect(`/inventory/incoming/${id}?msg=${encodeURIComponent(`Sent back${sent.status === "sent" ? " (they were emailed)" : ""}. Nothing went into stock.`)}`);
}

// ------------------------------------------------------------------ transfers
export type TransferInput = { from: string; to: string; arrive: string; ref: string; note: string; lines: { product_id: string; qty: number; lot_id?: number | null }[] };

export async function sendTransfer(input: TransferInput): Promise<{ ok: false; error: string } | never> {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "transfers")) return { ok: false, error: "You don't have access to transfers." };
  if (!hubAllows(s.profile, input.from)) return { ok: false, error: "Warehouse managers can only send stock from their own location." };
  const { data, error } = await s.supabase.rpc("transfer_send", {
    p_from: input.from,
    p_to: input.to,
    p_arrive: input.arrive || null,
    p_ref: input.ref,
    p_note: input.note,
    p_lines: input.lines,
  });
  if (error) return { ok: false, error: error.message };
  kickSync(input.from, "transfer sent");
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  redirect(`/inventory/transfers/${data}?msg=${encodeURIComponent("Sent. It came off stock here and shows as incoming at the other location.")}`);
}

export async function cancelTransfer(form: FormData) {
  const s = await getSession();
  const id = Number(form.get("id"));
  if (!s?.profile || !can(s.profile, "transfers")) redirect(`/inventory/transfers/${id}?err=${encodeURIComponent("You don't have access to transfers.")}`);
  const { error } = await s.supabase.rpc("transfer_cancel", { p_id: id });
  if (error) redirect(`/inventory/transfers/${id}?err=${encodeURIComponent(error.message)}`);
  const { data: t } = await s.supabase.from("inventory_transfers").select("from_branch").eq("id", id).maybeSingle<{ from_branch: string }>();
  if (t) kickSync(t.from_branch, "transfer cancelled");
  revalidatePath("/inventory", "layout");
  redirect(`/inventory/transfers/${id}?msg=${encodeURIComponent("Cancelled. The stock is back at this location.")}`);
}

/** Admins: each item's List value (what it's worth on the Inventory Hub dashboards only). Blank or 0 = none. */
export async function saveListValues(changes: { id: string; value: string }[]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin" || s.profile.status !== "active") return { ok: false, error: "Only admins can change List values." };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const set: { product_id: string; list_value: number; updated_at: string; updated_by_name: string | null }[] = [];
  const clear: string[] = [];
  const now = new Date().toISOString();
  for (const c of (changes ?? []).slice(0, 2000)) {
    if (!UUID.test(String(c?.id ?? ""))) continue;
    const raw = String(c.value ?? "").replace(/[$,\s]/g, "");
    if (raw === "" || Number(raw) === 0) {
      clear.push(c.id);
      continue;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 10_000_000) return { ok: false, error: `"${c.value}" isn't a dollar amount.` };
    set.push({ product_id: c.id, list_value: Math.round(v * 100) / 100, updated_at: now, updated_by_name: s.profile.full_name ?? s.profile.email });
  }
  if (set.length) {
    const { error } = await s.supabase.from("product_values").upsert(set, { onConflict: "product_id" });
    if (error) return { ok: false, error: /product_values/.test(error.message) ? "The database update for List values (0039) hasn't been run yet." : error.message };
  }
  if (clear.length) {
    const { error } = await s.supabase.from("product_values").delete().in("product_id", clear);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/inventory", "layout");
  return { ok: true, saved: set.length + clear.length };
}
