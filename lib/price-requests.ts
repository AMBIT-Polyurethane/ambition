import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, wrapEmail } from "@/lib/email";
import { escapeHtml as h, money } from "@/lib/format";
import { currentOrigin } from "@/lib/origin";
import { sendPush } from "@/lib/push";

// Price Requests in the app (0066). Reps ask for a price per product; lines that meet the admin's rules are approved
// on the spot, the rest wait for a price approver (Price approvals). Older requests stay in Jotform.

export type PrRow = {
  id: number; created_by: string | null; rep_name: string | null; company_id: string | null; company_name: string; contact: string | null;
  branch_id: string | null; note: string | null; valid_until: string | null; status: "pending" | "approved" | "partly" | "denied" | "withdrawn";
  decided_by_name: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
};
export type PrLine = {
  id: number; request_id: number; product_id: string | null; sku: string; name: string; unit: string | null; list_price: number | null;
  requested_price: number; volume: string | null; approved_price: number | null; status: "pending" | "approved" | "denied"; auto: boolean; rule: string | null;
};
export type PriceRules = { enabled: boolean; max_pct: number; cat_pct: Record<string, number>; never: string[]; max_lines: number };
export const DEFAULT_RULES: PriceRules = { enabled: false, max_pct: 5, cat_pct: {}, never: [], max_lines: 15 };
export const prRef = (id: number) => `PR-${1000 + id}`;
export const PR_STATUS: Record<PrRow["status"], { label: string; pill: string }> = {
  pending: { label: "Waiting", pill: "pill warn" },
  approved: { label: "Approved", pill: "pill ok" },
  partly: { label: "Partly approved", pill: "pill warn" },
  denied: { label: "Not approved", pill: "pill red" },
  withdrawn: { label: "Withdrawn", pill: "pill grey" },
};

export async function priceRules(db: SupabaseClient): Promise<PriceRules> {
  const { data } = await db.from("app_settings").select("value").eq("key", "price_rules").maybeSingle();
  const v = (data?.value ?? {}) as Partial<PriceRules>;
  return {
    enabled: Boolean(v.enabled),
    max_pct: Number.isFinite(Number(v.max_pct)) ? Number(v.max_pct) : DEFAULT_RULES.max_pct,
    cat_pct: v.cat_pct && typeof v.cat_pct === "object" ? Object.fromEntries(Object.entries(v.cat_pct).map(([k, n]) => [k, Number(n)]).filter(([, n]) => Number.isFinite(n))) : {},
    never: Array.isArray(v.never) ? v.never.filter((x): x is string => typeof x === "string") : [],
    max_lines: Number(v.max_lines) > 0 ? Number(v.max_lines) : DEFAULT_RULES.max_lines,
  };
}

/** Everyone who approves prices (admins and anyone given "Approve price requests"). */
async function approvers(db: SupabaseClient): Promise<{ id: string; email: string }[]> {
  const { data } = await db.from("profiles").select("id, email, role, perms").eq("status", "active").eq("demo", false).in("role", ["admin", "employee"]);
  return ((data ?? []) as { id: string; email: string; role: string; perms: string[] | null }[]).filter((p) => p.role === "admin" || (p.perms ?? []).includes("prf_approve"));
}

const table = (lines: PrLine[], approved: boolean) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px;">
<tr style="background:#0A0A0B;color:#fff;"><th align="left" style="padding:8px;font-size:11px;letter-spacing:1px;">PRODUCT</th><th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">LIST</th><th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">ASKED</th>${approved ? '<th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">APPROVED</th>' : ""}</tr>
${lines
  .map(
    (l) => `<tr><td style="padding:9px 8px;border-bottom:1px solid #eee;font-size:14px;"><b>${h(l.name)}</b><br><span style="font-size:12px;color:#71717a;">${h(l.sku)}${l.volume ? ` · ${h(l.volume)}` : ""}${l.auto ? " · approved by the rules" : ""}</span></td>
<td style="padding:9px 8px;border-bottom:1px solid #eee;text-align:right;color:#71717a;">${l.list_price !== null ? h(money(Number(l.list_price))) : "-"}</td>
<td style="padding:9px 8px;border-bottom:1px solid #eee;text-align:right;">${h(money(Number(l.requested_price)))}</td>
${approved ? `<td style="padding:9px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:800;">${l.status === "approved" && l.approved_price !== null ? h(money(Number(l.approved_price))) : l.status === "denied" ? '<span style="color:#b91c1c;">No</span>' : "Waiting"}</td>` : ""}</tr>`,
  )
  .join("")}</table>`;

/** New request with lines waiting: the approvers hear about it. */
export async function tellApprovers(db: SupabaseClient, r: PrRow, lines: PrLine[]) {
  const link = `${await currentOrigin()}/price-requests/n/${r.id}`;
  const who = await approvers(db);
  const waiting = lines.filter((l) => l.status === "pending");
  const subject = `Price request ${prRef(r.id)} · ${r.company_name} · ${waiting.length} to approve`;
  const inner = `<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">PRICE REQUEST · ${h(prRef(r.id))}</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 8px;">${h(r.company_name)}</div>
<p style="font-size:15px;margin:0;line-height:1.5;">${h(r.rep_name ?? "A rep")} is asking for these prices.${lines.length > waiting.length ? ` ${lines.length - waiting.length} met the rules and were approved already.` : ""}</p>
${r.note ? `<p style="font-size:14px;margin:12px 0 0;padding:10px 12px;background:#f4f4f5;border-radius:8px;">${h(r.note)}</p>` : ""}
${table(waiting, false)}
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">APPROVE OR CHANGE</a></p>`;
  await Promise.all([
    who.length ? sendEmail({ to: who.map((w) => w.email), subject, html: wrapEmail("Price request", inner), text: `${subject}\n\n${link}` }) : null,
    sendPush(who.map((w) => w.id), { title: `Price request · ${r.company_name}`, body: `${r.rep_name ?? "A rep"}: ${waiting.length} ${waiting.length === 1 ? "price" : "prices"} to approve`, url: `/price-requests/n/${r.id}`, tag: "prf" }).catch(() => 0),
  ]);
}

/** Decided (by a manager, or all of it by the rules): the rep hears back. */
export async function tellRep(db: SupabaseClient, r: PrRow, lines: PrLine[]) {
  if (!r.created_by) return;
  const { data: rep } = await db.from("profiles").select("email").eq("id", r.created_by).maybeSingle();
  const link = `${await currentOrigin()}/price-requests/n/${r.id}`;
  const subject = `${PR_STATUS[r.status].label}: ${prRef(r.id)} · ${r.company_name}`;
  const inner = `<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:${r.status === "denied" ? "#b91c1c" : "#15803d"};">${h(PR_STATUS[r.status].label.toUpperCase())}</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 8px;">${h(r.company_name)}</div>
<p style="font-size:15px;margin:0;line-height:1.5;">${h(r.decided_by_name ?? "A manager")} answered your price request ${h(prRef(r.id))}.${r.valid_until ? ` Good through ${h(r.valid_until)}.` : ""}</p>
${r.decision_note ? `<p style="font-size:14px;margin:12px 0 0;padding:10px 12px;background:#f4f4f5;border-radius:8px;">${h(r.decision_note)}</p>` : ""}
${table(lines, true)}
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">OPEN IN AMBIT A.I.</a></p>`;
  await Promise.all([
    rep?.email ? sendEmail({ to: [rep.email as string], subject, html: wrapEmail("Price request", inner), text: `${subject}\n\n${link}` }) : null,
    sendPush([r.created_by], { title: PR_STATUS[r.status].label, body: `${prRef(r.id)} · ${r.company_name}`, url: `/price-requests/n/${r.id}`, tag: "prf" }).catch(() => 0),
  ]);
}
