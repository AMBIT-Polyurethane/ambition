import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, wrapEmail, type SendResult } from "@/lib/email";
import { escapeHtml as h, dateShort, money } from "@/lib/format";
import { currentOrigin } from "@/lib/origin";
import { sendPush } from "@/lib/push";

// Personal purchases on an AMBIT card (0063): payroll takes them out of the employee's next paycheck.

export type Payroll = { name: string; email: string };
export const DEFAULT_PAYROLL: Payroll = { name: "Al Rearick", email: "al.rearick@ambitpu.com" };

/** Who handles paycheck deductions (Admin > Expenses > Payroll contact; Al Rearick until it's set). */
export async function payrollContact(db: SupabaseClient): Promise<Payroll> {
  const { data } = await db.from("app_settings").select("value").eq("key", "payroll").maybeSingle();
  const v = (data?.value ?? {}) as Partial<Payroll>;
  return { name: v.name?.trim() || DEFAULT_PAYROLL.name, email: v.email?.trim() || DEFAULT_PAYROLL.email };
}

/** Is this person payroll (or someone who can see the list anyway)? */
export async function canSeePayroll(db: SupabaseClient, p: { email: string; role: string; expense_approver?: boolean | null }) {
  if (p.role === "admin" || p.expense_approver) return true;
  const pay = await payrollContact(db);
  return pay.email.toLowerCase() === p.email.toLowerCase();
}

/** Tells payroll (email, and a phone notification if they use the app) to take it out of the next paycheck. */
export async function tellPayroll(
  db: SupabaseClient,
  c: { employee: string; employeeEmail: string; amount: number; day: string; merchant: string; card: string | null; note: string | null },
): Promise<SendResult> {
  const pay = await payrollContact(db);
  const link = `${await currentOrigin()}/expenses/payroll`;
  const subject = `Paycheck deduction: ${c.employee}, ${money(c.amount)} personal purchase on an AMBIT card`;
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">PAYCHECK DEDUCTION</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 12px;">${h(c.employee)} · ${h(money(c.amount))}</div>
<p style="font-size:15px;margin:0 0 12px;line-height:1.5;">Hi ${h(pay.name.split(" ")[0])}, ${h(c.employee)} made a personal purchase on their AMBIT card and asked for it to be taken out of their next paycheck.</p>
<table style="font-size:14px;line-height:1.6;border-collapse:collapse;">
<tr><td style="color:#71717a;padding-right:14px;">Purchase</td><td><b>${h(c.merchant)}</b></td></tr>
<tr><td style="color:#71717a;padding-right:14px;">Date</td><td>${h(dateShort(c.day))}</td></tr>
<tr><td style="color:#71717a;padding-right:14px;">Amount</td><td><b>${h(money(c.amount))}</b></td></tr>
${c.card ? `<tr><td style="color:#71717a;padding-right:14px;">Card</td><td>ending ${h(c.card)}</td></tr>` : ""}
${c.note ? `<tr><td style="color:#71717a;padding-right:14px;">Their note</td><td>${h(c.note)}</td></tr>` : ""}
</table>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">MARK IT TAKEN OUT</a></p>
<p style="font-size:12px;color:#71717a;margin:14px 0 0;">Once it's on a paycheck, tap the button (or open Expenses › Paycheck deductions in AMBIT Intelligence) and mark it taken out.</p>`;
  const text = [subject, "", `Purchase: ${c.merchant}`, `Date: ${dateShort(c.day)}`, `Amount: ${money(c.amount)}`, c.note ? `Note: ${c.note}` : "", "", link].filter((l) => l !== null).join("\n");
  const res = await sendEmail({ to: [pay.email], cc: [c.employeeEmail], subject, html: wrapEmail("Paycheck deduction", inner), text });
  const { data: who } = await db.from("profiles").select("id").ilike("email", pay.email).maybeSingle();
  if (who?.id) await sendPush([who.id as string], { title: "Paycheck deduction", body: `${c.employee}: ${money(c.amount)} at ${c.merchant}`, url: "/expenses/payroll", tag: "payroll" }).catch(() => 0);
  return res;
}
