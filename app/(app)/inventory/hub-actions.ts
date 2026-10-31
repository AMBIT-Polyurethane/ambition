"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/access";
import { claudeReady, friendlyClaudeError } from "@/lib/ai/claude";
import { stockItems } from "@/lib/incoming";
import { readBol, type BolRead } from "@/lib/inventory/bol";
import { kickSync } from "@/lib/inventory/sync";

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

export type ReportLine = { id?: number | null; product_id: string; qty: number; received_qty: number; lot_no?: string; mfg?: string; exp?: string; note?: string };
export type ReportInput = {
  id: number | null;
  branch: string;
  head: { vendor: string; bol_no: string; po_no: string; carrier: string; received_on: string; note: string; files: { path: string; name: string }[]; read_by_ai: boolean; ai_cost_cents: number };
  lines: ReportLine[];
};

/** Receive: what came goes into stock (and FOAM LOTS) and the report is saved with the BOL. */
export async function receiveReport(input: ReportInput): Promise<{ ok: false; error: string } | never> {
  const s = await receiver();
  if (!s) return { ok: false, error: "You don't have access to receiving." };
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
      lot_no: l.lot_no ?? "",
      mfg: l.mfg ?? "",
      exp: l.exp ?? "",
      note: l.note ?? "",
    })),
  });
  if (error) return { ok: false, error: error.message };
  kickSync(input.branch, "receiving report");
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  redirect(`/inventory/incoming/${data}?msg=${encodeURIComponent("Received. Stock updated; the spreadsheet catches up within 2 minutes.")}`);
}

// ------------------------------------------------------------------ transfers
export type TransferInput = { from: string; to: string; arrive: string; ref: string; note: string; lines: { product_id: string; qty: number; lot_id?: number | null }[] };

export async function sendTransfer(input: TransferInput): Promise<{ ok: false; error: string } | never> {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "transfers")) return { ok: false, error: "You don't have access to transfers." };
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
