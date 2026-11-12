"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { HUB_LOCKED_MSG, can, hubAllows } from "@/lib/access";
import { claudeReady, friendlyClaudeError } from "@/lib/ai/claude";
import { NO_PACKING, paperwork, readFiles, sameBol, stockItems, type BolMatch, type ReportFile } from "@/lib/incoming";
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
export async function readBolAction(input: { branch: string; paths: string[]; kind?: "bol" | "packing" }): Promise<{ ok: true; read: BolRead } | { ok: false; error: string }> {
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
    const read = await readBol({ supabase: s.supabase, branchName: `${b.name}, ${b.state}`, items, paths, kind: input.kind === "packing" ? "packing" : input.kind === "bol" ? "bol" : undefined });
    return { ok: true, read };
  } catch (e) {
    console.error("BOL read failed", e);
    return { ok: false, error: e instanceof Error && /open the file/.test(e.message) ? e.message : friendlyClaudeError(e) };
  }
}

/** The BOL # typed or read on a new report: earlier reports here with the same BOL # (to catch a truck sent twice). */
export async function bolMatches(input: { branch: string; bol: string; except?: number | null }): Promise<BolMatch[]> {
  const s = await receiver();
  if (!s || !hubAllows(s.profile, String(input.branch ?? ""))) return [];
  return sameBol(s.supabase, String(input.branch), String(input.bol ?? "").slice(0, 80), input.except ?? null);
}

export type ReportLine = { id?: number | null; product_id: string; qty: number; received_qty: number; damaged_qty?: number; lot_no?: string; mfg?: string; exp?: string; note?: string };
export type ReportInput = {
  id: number | null;
  branch: string;
  head: { vendor: string; bol_no: string; po_no: string; carrier: string; received_on: string; note: string; files: ReportFile[]; read_by_ai: boolean; ai_cost_cents: number };
  lines: ReportLine[];
  /** The BOL # is already on another report here and the receiver confirmed this is a new load on it. */
  newLoad?: boolean;
  /** No packing list came with the truck: why (the report is flagged for the admin). */
  noPacking?: string;
  /** Sent-back reports for this same truck that this report redoes: they're closed once this one is sent. */
  replaces?: number[];
};

const KINDS = new Set(["bol", "packing", "other"]);
const cleanFiles = (list: ReportFile[] | undefined, branch: string): ReportFile[] =>
  (list ?? [])
    .filter((f) => FILE.test(String(f?.path ?? "")) && f.path.startsWith(`${branch}/`))
    .slice(0, 20)
    .map((f) => ({ path: f.path, name: String(f.name ?? "").slice(0, 120) || "file", kind: KINDS.has(String(f.kind)) ? f.kind : "other" }));

/**
 * Receive: the report is saved with the BOL. An admin's report goes straight into stock (FOAM LOTS / RECEIVED LOTS);
 * anyone else's waits for an admin to approve it, and the admins are emailed.
 */
export async function receiveReport(input: ReportInput): Promise<{ ok: false; error: string } | never> {
  const s = await receiver();
  if (!s) return { ok: false, error: "You don't have access to receiving." };
  if (!hubAllows(s.profile, input.branch)) return { ok: false, error: HUB_LOCKED_MSG };
  const files = cleanFiles(input.head.files, input.branch);
  let note = String(input.head.note ?? "");
  // Both the BOL and the packing list (0067), on every report from a vendor: the BOL is the trucking paperwork
  // (lot numbers are often written on it by hand), the packing list is the manufacturer's own lots and dates.
  // Not for transfers between AMBIT locations, or an admin changing a report while approving it.
  type Prior = { status: string; transfer_id: number | null; files: unknown };
  const prior: Prior | null = input.id
    ? ((await s.supabase.from("inbound_deliveries").select("status, transfer_id, files").eq("id", input.id).maybeSingle<Prior>()).data ?? null)
    : null;
  if (!prior?.transfer_id && (!prior || prior.status === "expected")) {
    const pw = paperwork([...readFiles(prior?.files), ...files]);
    if (!pw.bol) return { ok: false, error: "Add the BOL first: take a photo of it or upload the PDF (step 1 at the top)." };
    const why = String(input.noPacking ?? "").trim().slice(0, 200);
    if (!pw.packing) {
      if (why.length < 3) return { ok: false, error: 'Add the packing list (step 2 at the top). If none came with this truck, tick "No packing list came with this truck" and say why.' };
      if (!note.includes(NO_PACKING)) note = [`${NO_PACKING}${why}`, note].filter(Boolean).join(" · ");
    }
  }
  // Same BOL # as another report here. A report an admin sent back for this same truck is closed once this one is
  // sent (it never went into stock). Anything else: only as a new load on the same ticket, said out loud.
  const earlier = input.head.bol_no ? await sameBol(s.supabase, input.branch, input.head.bol_no, input.id) : [];
  const want = new Set((input.replaces ?? []).map(Number));
  const replaces = earlier.filter((m) => m.status === "sent_back" && want.has(m.id)).map((m) => m.id);
  const dupes = earlier.filter((m) => !replaces.includes(m.id));
  if (dupes.length) {
    if (!input.newLoad) {
      return {
        ok: false,
        error: `BOL ${input.head.bol_no} is already on ${dupes.length === 1 ? "report" : "reports"} ${dupes.map((m) => `#${m.id}`).join(", ")}. If this is the same truck, don't send it again. If it's a new load on the same ticket, tick "This is a new load".`,
      };
    }
    const tag = `Load ${dupes.length + 1} on BOL ${input.head.bol_no}`;
    if (!note.startsWith("Load ")) note = [tag, note].filter(Boolean).join(" · ");
  }
  const { data, error } = await s.supabase.rpc("inbound_receive_report", {
    p_id: input.id,
    p_branch: input.branch,
    p_head: { ...input.head, note, files },
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
  // The sent-back report(s) this one redoes: closed, so the truck shows (and counts) once.
  const closed: number[] = [];
  for (const old of replaces) {
    let r = await s.supabase.rpc("inbound_replace", { p_old: old, p_new: id });
    if (r.error && /inbound_replace|function|schema cache/i.test(r.error.message)) r = await s.supabase.rpc("inbound_cancel", { p_id: old }); // before 0067
    if (!r.error) closed.push(old);
    else console.error("closing the sent-back report failed", old, r.error.message);
  }
  const also = closed.length ? ` Report ${closed.map((n) => `#${n}`).join(", ")} (sent back for this same truck) was closed.` : "";
  const { data: now } = await s.supabase.from("inbound_deliveries").select("status").eq("id", id).maybeSingle<{ status: string }>();
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  if (now?.status === "submitted") {
    const sent = await emailAdminsReportWaiting(s.supabase, id);
    redirect(
      `/inventory/incoming/${id}?msg=${encodeURIComponent(
        `Sent to an admin for approval${sent.status === "sent" ? " (they were emailed)" : ""}. Stock and the spreadsheet update once it's approved.${also}`,
      )}`,
    );
  }
  kickSync(input.branch, "receiving report");
  redirect(`/inventory/incoming/${id}?msg=${encodeURIComponent(`Received. Stock updated; the spreadsheet catches up within 2 minutes.${also}`)}`);
}

/** A sent-back report that was redone as another report for the same truck: close it (nothing from it is in stock). */
export async function closeRedone(form: FormData) {
  const s = await receiver();
  const old = Number(form.get("old"));
  const now = Number(form.get("new"));
  const back = `/inventory/incoming/${Number.isFinite(now) ? now : old}`;
  if (!s || !Number.isFinite(old) || !Number.isFinite(now)) return;
  let r = await s.supabase.rpc("inbound_replace", { p_old: old, p_new: now });
  if (r.error && /inbound_replace|function|schema cache/i.test(r.error.message)) r = await s.supabase.rpc("inbound_cancel", { p_id: old }); // before 0067
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
  if (r.error) redirect(`${back}?err=${encodeURIComponent(r.error.message)}`);
  redirect(`${back}?msg=${encodeURIComponent(`Report #${old} closed: redone on this report. It no longer shows as on the way.`)}`);
}

/** Add paperwork to a report already sent: the packing list that came later, a photo of damage. */
export async function addReportFiles(input: { id: number; files: ReportFile[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await receiver();
  if (!s) return { ok: false, error: "You don't have access to receiving." };
  const id = Number(input.id);
  const { data: d } = await s.supabase.from("inbound_deliveries").select("branch_id").eq("id", id).maybeSingle<{ branch_id: string }>();
  if (!d) return { ok: false, error: "Report not found." };
  if (!hubAllows(s.profile, d.branch_id)) return { ok: false, error: HUB_LOCKED_MSG };
  const files = cleanFiles(input.files, d.branch_id);
  if (!files.length) return { ok: false, error: "Add a photo or PDF." };
  const { error } = await s.supabase.rpc("inbound_add_files", { p_id: id, p_files: files });
  if (error) return { ok: false, error: /inbound_add_files|function|schema cache/i.test(error.message) ? "Adding paperwork to a report needs the 0067 database update. Ask Jeremiah to run it." : error.message };
  revalidatePath(`/inventory/incoming/${id}`);
  revalidatePath("/inventory", "layout");
  return { ok: true };
}

/** Admin: approve a Receiving Report as it was sent. Stock and the spreadsheet update. */
export async function approveReceiving(form: FormData) {
  const s = await getSession();
  const id = Number(form.get("id"));
  if (!s?.profile || s.profile.role !== "admin" || !Number.isFinite(id)) return;
  // A report done since BOLs and packing lists were separate, with no packing list: approved only on purpose.
  const { data: d0 } = await s.supabase.from("inbound_deliveries").select("files, transfer_id").eq("id", id).maybeSingle<{ files: unknown; transfer_id: number | null }>();
  const pw = paperwork(readFiles(d0?.files));
  if (d0 && !d0.transfer_id && pw.labeled && !pw.packing && form.get("nopack_ok") !== "1") {
    redirect(`/inventory/incoming/${id}?err=${encodeURIComponent('There\'s no packing list on this report. Add it under "Add paperwork", or tick "Approve without a packing list".')}`);
  }
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
