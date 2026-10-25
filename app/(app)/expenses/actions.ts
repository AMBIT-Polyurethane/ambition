"use server";

import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { sendEmail, wrapEmail } from "@/lib/email";
import { escapeHtml as h, money } from "@/lib/format";
import { REPORT_TO, isMonth, monthLabel, receiptsFor, totals } from "@/lib/expenses";
import { expensePdfName, renderExpensePdf } from "@/lib/expense-doc/pdf";

export type SendState = { ok?: string; error?: string; warn?: string } | null;

/** Sends this person's report for the month to Corporate (PDF attached) and remembers that it was sent. */
export async function sendReport(_prev: SendState, form: FormData): Promise<SendState> {
  const { supabase, profile } = await requireEmployee();
  const month = String(form.get("month") ?? "");
  if (!isMonth(month)) return { error: "Pick a month first." };

  let receipts;
  try {
    receipts = await receiptsFor(month, profile.email);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't read your receipts from Jotform. Try again in a minute." };
  }
  if (!receipts.length) return { error: `You don't have any receipts for ${monthLabel(month)} yet.` };

  const name = profile.full_name || profile.email;
  const t = totals(receipts);
  const sentAt = new Date().toISOString();
  const pdf = await renderExpensePdf({ name, email: profile.email, month, receipts, sentAt });
  const origin = await currentOrigin();
  const label = monthLabel(month);

  const rows = t.byCategory
    .map((c) => `<tr><td style="padding:5px 0;font-size:14px;">${h(c.category)}</td><td style="padding:5px 0;font-size:13px;color:#71717a;">${c.count}</td><td style="padding:5px 0;font-size:14px;font-weight:700;text-align:right;">${h(money(c.total))}</td></tr>`)
    .join("");
  const res = await sendEmail({
    to: REPORT_TO,
    cc: [profile.email],
    replyTo: profile.email,
    subject: `Expense report · ${name} · ${label} · ${money(t.total)}`,
    html: wrapEmail(
      "Expense report",
      `<div style="font-size:22px;font-weight:800;margin-bottom:4px;">${h(name)}: ${h(label)}</div>
<div style="font-size:14px;color:#52525b;margin-bottom:16px;">${t.count} ${t.count === 1 ? "receipt" : "receipts"} · Total <b style="color:#18181b;">${h(money(t.total))}</b> · AMBIT card ${h(money(t.card))} · Pay back to employee <b style="color:${t.personal > 0 ? "#E33527" : "#18181b"};">${h(money(t.personal))}</b></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;">${rows}</table>
<p style="font-size:13px;color:#52525b;margin:16px 0 0;">The full report with every receipt photo is attached as a PDF. Admins can also see it in AMBIT Intelligence: <a href="${h(origin)}/admin/expenses?m=${month}">Admin → Expense reports</a>.</p>`,
    ),
    text: `Expense report: ${name}, ${label}\n${t.count} receipts, total ${money(t.total)} (AMBIT card ${money(t.card)}, pay back to employee ${money(t.personal)})\n\nPDF attached. ${origin}/admin/expenses?m=${month}`,
    attachments: [{ filename: expensePdfName(name, month), content: pdf, contentType: "application/pdf" }],
  });

  const { error } = await supabase.from("expense_reports").upsert(
    {
      user_id: profile.id,
      month: `${month}-01`,
      receipt_ids: receipts.map((r) => r.id),
      receipt_count: t.count,
      total: t.total,
      card_total: t.card,
      personal_total: t.personal,
      sent_at: sentAt,
      sent_to: REPORT_TO,
      email_status: res.status,
    },
    { onConflict: "user_id,month" },
  );
  revalidatePath("/expenses");
  revalidatePath("/admin/expenses");

  if (res.status === "sent") return { ok: `Sent to Corporate: ${label}, ${t.count} ${t.count === 1 ? "receipt" : "receipts"}, ${money(t.total)}. A copy went to ${profile.email}.` };
  const saved = error ? "" : "It's saved as sent, so Corporate can open it in AMBIT Intelligence (Admin → Expense reports). ";
  return {
    warn:
      res.status === "not_configured"
        ? `${saved}The app can't email yet, so also tap Download PDF and email it to Corporate yourself.`
        : `${saved}The email didn't go through${res.error ? ` (${res.error.slice(0, 120)})` : ""}. Tap Download PDF and email it to Corporate yourself.`,
  };
}
