import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { sendEmail, wrapEmail, type SendResult } from "@/lib/email";
import { escapeHtml as h } from "@/lib/format";
import { currentOrigin } from "@/lib/origin";
import { sendPush } from "@/lib/push";
import { payrollContact } from "@/lib/payroll";

// Reorder points and reorder requests (0064). Reorder points are set on the Stock screen (admins, CRMs and the
// location's warehouse manager); admins and CRMs check items and send a reorder request to purchasing (Al Rearick).

export type Buyer = { name: string; email: string };

/** Who reorder requests go to (Admin can change it on Reorder requests; Al Rearick, like payroll, until then). */
export async function purchasingContact(db: SupabaseClient): Promise<Buyer> {
  const { data } = await db.from("app_settings").select("value").eq("key", "purchasing").maybeSingle();
  const v = (data?.value ?? {}) as Partial<Buyer>;
  if (v.email?.trim()) return { name: v.name?.trim() || v.email.trim(), email: v.email.trim() };
  return payrollContact(db);
}

export const canSetRop = (p: Pick<Profile, "role" | "branch_id"> & { job_role?: string | null }, branch: string) =>
  p.role === "admin" || (p.role === "employee" && (p.job_role === "crm" || (p.job_role === "warehouse" && p.branch_id === branch)));
export const canRequestReorder = (p: Pick<Profile, "role"> & { job_role?: string | null }) => p.role === "admin" || (p.role === "employee" && p.job_role === "crm");

/** How much of each item sold at a location in the last `days` days (orders that weren't cancelled). */
export async function soldByProduct(db: SupabaseClient, branch: string, days = 60): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data, error } = await db.rpc("sold_by_product", { p_branch: branch, p_days: days });
  if (!error) {
    for (const r of (data ?? []) as { product_id: string; qty: number }[]) out.set(r.product_id, Number(r.qty));
    return out;
  }
  // Before 0064: add it up from the orders.
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: rows } = await db
    .from("order_items")
    .select("product_id, qty, order:orders!inner(branch_id, status, created_at)")
    .eq("order.branch_id", branch)
    .neq("order.status", "cancelled")
    .gte("order.created_at", since)
    .not("product_id", "is", null)
    .range(0, 19999);
  for (const r of (rows ?? []) as unknown as { product_id: string; qty: number }[]) out.set(r.product_id, (out.get(r.product_id) ?? 0) + Number(r.qty));
  return out;
}

/** A reorder point that covers `weeks` weeks of what sold in the last 60 days (0 when nothing sold). */
export const suggestRop = (sold60: number, weeks = 3) => (sold60 > 0 ? Math.max(1, Math.ceil((sold60 / 60) * weeks * 7)) : 0);

/** How many to order: up to Max when it's set, otherwise back to twice the reorder point (at least a month of sales). */
export function suggestQty(r: { net: number | null; reorder_point: number | null; max_qty: number | null; sold60: number }) {
  const net = r.net ?? 0;
  const target = r.max_qty && r.max_qty > 0 ? r.max_qty : Math.max((r.reorder_point ?? 0) * 2, Math.ceil(r.sold60 / 2), 1);
  return Math.max(1, Math.ceil(target - net));
}

export type ReorderLine = { sku: string; name: string; unit: string | null; qty: number; on_hand: number | null; available: number | null; reorder_point: number | null; sold_60: number | null };
export const reorderRef = (id: number) => `RR-${1000 + id}`;

/** Emails purchasing the request (and a phone notification if they use the app). */
export async function sendReorderRequest(
  db: SupabaseClient,
  r: { id: number; branchName: string; by: string; byEmail: string; note: string | null; lines: ReorderLine[] },
): Promise<SendResult> {
  const buyer = await purchasingContact(db);
  const link = `${await currentOrigin()}/inventory/reorders/${r.id}`;
  const ref = reorderRef(r.id);
  const n = (v: number | null) => (v === null || v === undefined ? "–" : String(Math.round(Number(v) * 100) / 100));
  const subject = `Reorder request ${ref} · ${r.branchName} · ${r.lines.length} ${r.lines.length === 1 ? "item" : "items"}`;
  const rows = r.lines
    .map(
      (l) => `<tr>
<td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;"><b>${h(l.name)}</b><br><span style="color:#71717a;font-size:12px;">${h(l.sku)}</span></td>
<td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;text-align:right;font-size:16px;"><b>${h(n(l.qty))}</b> <span style="color:#71717a;font-size:12px;">${h(l.unit ?? "")}</span></td>
<td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;text-align:right;color:#52525b;">${h(n(l.available))}</td>
<td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;text-align:right;color:#52525b;">${h(n(l.reorder_point))}</td>
<td style="padding:8px 10px;border-bottom:1px solid #e4e4e7;text-align:right;color:#52525b;">${h(n(l.sold_60))}</td>
</tr>`,
    )
    .join("");
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">REORDER REQUEST · ${h(ref)}</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 12px;">${h(r.branchName)}</div>
<p style="font-size:15px;margin:0 0 12px;line-height:1.5;">Hi ${h(buyer.name.split(" ")[0])}, ${h(r.by)} is asking for these to be ordered for ${h(r.branchName)}.</p>
${r.note ? `<p style="font-size:14px;margin:0 0 12px;padding:10px 12px;background:#f4f4f5;border-radius:8px;"><b>Note:</b> ${h(r.note)}</p>` : ""}
<table style="width:100%;font-size:14px;border-collapse:collapse;">
<tr style="color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">
<th style="text-align:left;padding:6px 10px;">Item</th><th style="text-align:right;padding:6px 10px;">Order</th><th style="text-align:right;padding:6px 10px;">Available</th><th style="text-align:right;padding:6px 10px;">Reorder pt</th><th style="text-align:right;padding:6px 10px;">Sold 60 days</th>
</tr>
${rows}
</table>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">OPEN THE REQUEST</a></p>
<p style="font-size:12px;color:#71717a;margin:14px 0 0;">Once it's ordered, tap the button and mark it Ordered (or open Inventory Hub › Reorder requests in AMBIT Intelligence), so ${h(r.by.split(" ")[0])} knows.</p>`;
  const text = [subject, "", ...r.lines.map((l) => `${n(l.qty)} ${l.unit ?? ""} · ${l.sku} · ${l.name}`), r.note ? `\nNote: ${r.note}` : "", "", link].join("\n");
  const res = await sendEmail({ to: [buyer.email], cc: r.byEmail ? [r.byEmail] : [], subject, html: wrapEmail("Reorder request", inner), text });
  const { data: who } = await db.from("profiles").select("id").ilike("email", buyer.email).maybeSingle();
  if (who?.id) await sendPush([who.id as string], { title: `Reorder request · ${r.branchName}`, body: `${r.by}: ${r.lines.length} ${r.lines.length === 1 ? "item" : "items"}`, url: `/inventory/reorders/${r.id}`, tag: "reorder" }).catch(() => 0);
  return res;
}
