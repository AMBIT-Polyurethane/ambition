import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml as h } from "@/lib/format";
import { wrapEmail } from "@/lib/email";

// Admin > Data check (0080): everything that needs fixing, who it's on, and the email that tells them.

export type CheckRow = {
  kind: string;
  branch: string | null;
  order_id: string | null;
  order_no: number | null;
  lot_id: number | null;
  other_lot: number | null;
  title: string;
  detail: string;
  who: string | null;
};

export const KINDS: Record<string, { label: string; tone: "err" | "warn" | "info"; team?: string }> = {
  lot_negative: { label: "Lots below zero", tone: "err" },
  lot_overpromised: { label: "Lots promised to more orders than they have", tone: "err" },
  lot_duplicate: { label: "The same lot on two rows", tone: "warn" },
  open_past_date: { label: "Open orders past their pickup / delivery date", tone: "warn" },
  shipped_no_bol: { label: "Shipped with no signed BOL", tone: "warn" },
  shipped_no_lot: { label: "Shipped with no lot recorded", tone: "warn" },
  open_no_lot: { label: "Open orders with no lot picked", tone: "warn" },
  stuck: { label: "Orders stuck at a step", tone: "info" },
  change_waiting: { label: "Changes waiting for an admin", tone: "info", team: "Admins" },
  receiving_waiting: { label: "Receiving reports waiting for approval", tone: "info", team: "Admins" },
};
export const KIND_ORDER = Object.keys(KINDS);

/** Who a row is on: the people the app knows, else the team whose step it is. */
export function ownersOf(r: CheckRow): string[] {
  if (r.who) return r.who.split(/,\s*/).filter(Boolean);
  if (r.kind === "stuck") return [/accounting/i.test(r.detail) ? "Accounting" : /customer/i.test(r.detail) ? "Sales reps" : "Order desk"];
  if (r.kind === "lot_negative" || r.kind === "lot_overpromised" || r.kind === "open_no_lot") return [`Warehouse ${(r.branch ?? "").toUpperCase()}`];
  if (r.kind === "shipped_no_bol" || r.kind === "shipped_no_lot") return [`Warehouse ${(r.branch ?? "").toUpperCase()}`];
  return [KINDS[r.kind]?.team ?? "Admins"];
}

export async function loadCheck(db: SupabaseClient): Promise<{ rows: CheckRow[]; error: string | null }> {
  const { data, error } = await db.rpc("data_check");
  if (error) return { rows: [], error: /data_check/.test(error.message) ? "The data check needs the 0080 database update first (Supabase > SQL Editor)." : error.message };
  return { rows: (data ?? []) as CheckRow[], error: null };
}

/** Everyone the email goes to for an owner: a person by name, or a team. */
export async function ownerEmails(db: SupabaseClient, owner: string): Promise<{ name: string; email: string }[]> {
  const { data } = await db.from("profiles").select("full_name, email, role, job_role, branch_id, perms, status").eq("status", "active").eq("demo", false).in("role", ["admin", "employee"]);
  type P = { full_name: string | null; email: string | null; role: string; job_role: string | null; branch_id: string | null; perms: string[] | null };
  const people = ((data ?? []) as P[]).filter((p) => p.email);
  const pick = (f: (p: P) => boolean) => people.filter(f).map((p) => ({ name: p.full_name ?? p.email!, email: p.email! }));
  const wh = /^Warehouse ([A-Z]+)$/.exec(owner);
  if (wh) return pick((p) => p.role === "employee" && p.job_role === "warehouse" && (p.branch_id ?? "").toUpperCase() === wh[1]);
  if (owner === "Order desk") return pick((p) => p.role === "employee" && (p.perms ?? []).includes("order_desk"));
  if (owner === "Accounting") return pick((p) => p.role === "employee" && (p.perms ?? []).includes("credit_check"));
  if (owner === "Admins") return pick((p) => p.role === "admin");
  if (owner === "Sales reps") return [];
  return pick((p) => (p.full_name ?? "").trim().toLowerCase() === owner.trim().toLowerCase());
}

/** The email: what's on them, how to fix each, and a deadline. Plain and direct. */
export function buildCheckEmail(owner: string, rows: CheckRow[], from: string, link: string) {
  const first = /^(Warehouse|Order desk|Accounting|Admins|Sales reps)/.test(owner) ? "team" : owner.split(/\s+/)[0];
  const groups = KIND_ORDER.map((k) => ({ k, list: rows.filter((r) => r.kind === k) })).filter((g) => g.list.length);
  const subject = `AMBIT A.I.: ${rows.length} ${rows.length === 1 ? "thing" : "things"} to fix`;
  const lines = groups.flatMap((g) => [`${KINDS[g.k].label}:`, ...g.list.map((r) => `- ${r.title}. ${r.detail}`), ""]);
  const text = [
    `Hi ${first},`,
    "",
    "The app's data check found these on you. They throw off our inventory and orders, so they need fixing:",
    "",
    ...lines,
    "Please fix them by the end of the day tomorrow and reply to this email when they're done. If one of these isn't yours, reply and say so.",
    "",
    "Going forward: close every order the day it goes out, attach the signed BOL every time, and type lot numbers exactly as they're printed on the drum.",
    "",
    from,
    link,
  ].join("\n");
  const html = wrapEmail(
    "Things to fix",
    `<p style="font-size:15px;margin:0 0 12px;">Hi ${h(first)},</p>
<p style="font-size:15px;margin:0 0 16px;line-height:1.5;">The app's data check found these on you. They throw off our inventory and orders, so they need fixing:</p>
${groups
  .map(
    (g) => `<div style="font-size:12px;font-weight:800;letter-spacing:1px;color:#E33527;margin:14px 0 6px;">${h(KINDS[g.k].label.toUpperCase())}</div>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5;">${g.list.map((r) => `<li style="margin-bottom:6px;"><b>${h(r.title)}.</b> ${h(r.detail)}</li>`).join("")}</ul>`,
  )
  .join("")}
<p style="font-size:15px;margin:18px 0 0;line-height:1.5;"><b>Please fix them by the end of the day tomorrow</b> and reply to this email when they're done. If one of these isn't yours, reply and say so.</p>
<p style="font-size:14px;margin:12px 0 0;line-height:1.5;color:#52525b;">Going forward: close every order the day it goes out, attach the signed BOL every time, and type lot numbers exactly as they're printed on the drum.</p>
<p style="font-size:15px;margin:16px 0 0;">${h(from)}</p>`,
  );
  return { subject, text, html };
}
