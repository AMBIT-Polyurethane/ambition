import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, wrapEmail, type SendResult } from "@/lib/email";
import { escapeHtml as h, qtyText } from "@/lib/format";
import { currentOrigin } from "@/lib/origin";

// Receiving Reports waiting for an admin (0041): tell the admins, and tell the receiver if it comes back.

type Report = {
  id: number;
  vendor: string;
  branch_id: string;
  bol_no: string | null;
  submitted_by_name: string | null;
  sent_back_note: string | null;
  sent_back_by_name: string | null;
  lines: { sku: string; name: string | null; unit: string | null; received_qty: number | null; damaged_qty: number | null; lot_no: string | null; exp: string | null }[];
};

async function load(db: SupabaseClient, id: number): Promise<(Report & { place: string }) | null> {
  const { data } = await db
    .from("inbound_deliveries")
    .select("id, vendor, branch_id, bol_no, submitted_by_name, sent_back_note, sent_back_by_name, lines:inbound_lines(sku, name, unit, received_qty, damaged_qty, lot_no, exp)")
    .eq("id", id)
    .maybeSingle<Report>();
  if (!data) return null;
  const { data: b } = await db.from("branches").select("name, state").eq("id", data.branch_id).maybeSingle<{ name: string; state: string }>();
  return { ...data, place: b ? `${b.name}, ${b.state}` : data.branch_id.toUpperCase() };
}

const lineText = (l: Report["lines"][number]) =>
  `${l.sku} ${l.name ?? ""}: ${qtyText(Number(l.received_qty ?? 0), l.unit ?? "each")}` +
  (Number(l.damaged_qty ?? 0) > 0 ? ` (${qtyText(Number(l.damaged_qty), l.unit ?? "each")} damaged)` : "") +
  (l.lot_no ? ` · lot ${l.lot_no}` : "") +
  (l.exp ? ` · exp ${l.exp}` : "");

/** To every active admin: a Receiving Report is waiting for approval. */
export async function emailAdminsReportWaiting(db: SupabaseClient, id: number): Promise<SendResult> {
  const r = await load(db, id);
  if (!r) return { status: "failed", error: "Report not found" };
  const { data: admins } = await db.from("profiles").select("email").eq("role", "admin").eq("status", "active");
  const to = ((admins ?? []) as { email: string }[]).map((a) => a.email).filter(Boolean);
  if (!to.length) return { status: "failed", error: "No admins" };
  const link = `${await currentOrigin()}/inventory/incoming/${id}`;
  const lines = r.lines.filter((l) => Number(l.received_qty ?? 0) > 0).map(lineText);
  const subject = `Receiving Report to approve · ${r.place} · ${r.vendor}`;
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">RECEIVING REPORT TO APPROVE</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 12px;">${h(r.place)} · ${h(r.vendor)}</div>
<p style="font-size:15px;margin:0 0 12px;line-height:1.5;">${h(r.submitted_by_name ?? "The warehouse")} received a delivery${r.bol_no ? ` (BOL # ${h(r.bol_no)})` : ""}. Stock and the location's spreadsheet change once you approve it.</p>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;">${lines.map((l) => `<li>${h(l)}</li>`).join("")}</ul>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">REVIEW AND APPROVE</a></p>`;
  const text = [`RECEIVING REPORT TO APPROVE: ${r.place} · ${r.vendor}`, "", ...lines.map((l) => `- ${l}`), "", link].join("\n");
  return sendEmail({ to, subject, html: wrapEmail("Receiving Report", inner), text });
}

/** To whoever sent it: an admin sent the report back with what to fix. */
export async function emailReceiverSentBack(db: SupabaseClient, id: number): Promise<SendResult> {
  const r = await load(db, id);
  if (!r || !r.submitted_by_name) return { status: "failed", error: "No receiver" };
  const { data: who } = await db.from("profiles").select("email").eq("full_name", r.submitted_by_name).eq("status", "active").limit(1);
  const to = ((who ?? []) as { email: string }[]).map((w) => w.email).filter(Boolean);
  if (!to.length) return { status: "failed", error: "No email for the receiver" };
  const link = `${await currentOrigin()}/inventory/incoming/${id}`;
  const subject = `Receiving Report sent back · ${r.place} · ${r.vendor}`;
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">RECEIVING REPORT SENT BACK</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 12px;">${h(r.place)} · ${h(r.vendor)}</div>
<p style="font-size:15px;margin:0 0 12px;line-height:1.5;">${h(r.sent_back_by_name ?? "An admin")} sent it back: <b>${h(r.sent_back_note ?? "")}</b></p>
<p style="font-size:14px;margin:0;line-height:1.5;">Nothing went into stock yet. Fix it and send it again.</p>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">OPEN THE REPORT</a></p>`;
  const text = [`RECEIVING REPORT SENT BACK: ${r.place} · ${r.vendor}`, `${r.sent_back_by_name ?? "An admin"}: ${r.sent_back_note ?? ""}`, "", link].join("\n");
  return sendEmail({ to, subject, html: wrapEmail("Receiving Report", inner), text });
}
