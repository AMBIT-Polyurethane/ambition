import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, wrapEmail, type SendResult } from "@/lib/email";
import { escapeHtml as h } from "@/lib/format";
import { currentOrigin } from "@/lib/origin";
import { textAdmins } from "@/lib/sms";

// Foam lots (0116): a warehouse fix of more than 2 drums waits for an admin. Tell the admins.

const REASON: Record<string, string> = { count: "Count difference", damaged: "Damaged", used: "Used here" };

export async function emailAdminsLotFix(db: SupabaseClient, id: number): Promise<SendResult> {
  const { data: c } = await db
    .from("inventory_lot_changes")
    .select("id, branch_id, lot_no, from_sku, qty, reason, note, by_name")
    .eq("id", id)
    .maybeSingle<{ id: number; branch_id: string; lot_no: string | null; from_sku: string | null; qty: number; reason: string | null; note: string | null; by_name: string | null }>();
  if (!c) return { status: "failed", error: "Not found" };
  const [{ data: b }, { data: admins }] = await Promise.all([
    db.from("branches").select("name, state").eq("id", c.branch_id).maybeSingle<{ name: string; state: string }>(),
    db.from("profiles").select("email").eq("role", "admin").eq("status", "active"),
  ]);
  const to = ((admins ?? []) as { email: string }[]).map((a) => a.email).filter(Boolean);
  if (!to.length) return { status: "failed", error: "No admins" };
  const place = b ? `${b.name}, ${b.state}` : c.branch_id.toUpperCase();
  const lot = c.lot_no || "(no lot #)";
  const qty = Number(c.qty);
  const change = `${qty > 0 ? "+" : ""}${qty} drum${Math.abs(qty) === 1 ? "" : "s"}`;
  const link = `${await currentOrigin()}/inventory/lots?b=${c.branch_id}`;
  const subject = `Lot fix to OK · ${place} · ${c.from_sku ?? ""} lot ${lot} (${change})`;
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">LOT FIX TO OK</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 12px;">${h(place)} · ${h(c.from_sku ?? "")} lot ${h(lot)}</div>
<p style="font-size:15px;margin:0 0 8px;line-height:1.5;"><b>${h(c.by_name ?? "The warehouse")}</b> wants to change this lot by <b>${h(change)}</b> (${h(REASON[c.reason ?? ""] ?? "Fix")}).</p>
${c.note ? `<p style="font-size:14px;margin:0 0 12px;color:#52525b;">&ldquo;${h(c.note)}&rdquo;</p>` : ""}
<p style="font-size:14px;margin:0 0 4px;color:#52525b;">Nothing changes on the lot or the spreadsheet until an admin OKs it.</p>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">OPEN FOAM LOTS</a></p>`;
  const text = [`LOT FIX TO OK: ${place} · ${c.from_sku ?? ""} lot ${lot}`, `${c.by_name ?? "The warehouse"}: ${change} (${REASON[c.reason ?? ""] ?? "Fix"})`, c.note ?? "", "", link].join("\n");
  // 0118: admins with text alerts on get a text too.
  await textAdmins(`AMBIT A.I.: lot fix to OK at ${place}: ${c.from_sku ?? ""} lot ${lot}, ${change} (${REASON[c.reason ?? ""] ?? "fix"}) from ${c.by_name ?? "the warehouse"}. ${link}`, String(id)).catch(() => 0);
  return sendEmail({ to, subject, html: wrapEmail("Lot fix", inner), text });
}
