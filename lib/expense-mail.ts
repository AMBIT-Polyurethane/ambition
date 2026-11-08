import "server-only";
import { sendEmail, wrapEmail, type EmailAttachment, type SendResult } from "@/lib/email";
import { dateShort, escapeHtml as h, money } from "@/lib/format";
import { chargeLabel, monthLabel, type MonthView, type XCharge } from "@/lib/expense-kinds";

// The expense emails: "ready for your approval" to the approvers, "approved" / "sent back" to the employee,
// and the weekly "these card charges need a receipt" reminder.

const btn = (href: string, text: string) =>
  `<a href="${h(href)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:12px 20px;border-radius:9px;">${h(text)}</a>`;

const catRows = (cats: { category: string; total: number; count: number }[]) =>
  cats
    .slice(0, 8)
    .map(
      (c) =>
        `<tr><td style="padding:5px 0;font-size:14px;">${h(c.category)}</td><td style="padding:5px 0;font-size:13px;color:#71717a;">${c.count}</td><td style="padding:5px 0;font-size:14px;font-weight:700;text-align:right;">${h(money(c.total))}</td></tr>`,
    )
    .join("");

export type Submitted = { userId: string; name: string; email: string; month: string; total: number; card: number; personal: number; receipts: number; charges: number; approvers: { email: string; name: string | null }[] };

/** To the approvers: a month is ready. */
export async function mailSubmitted(s: Submitted, view: MonthView, origin: string, opts: { auto?: boolean } = {}): Promise<SendResult> {
  const label = monthLabel(s.month);
  const link = `${origin}/admin/expenses/review?u=${s.userId}&m=${s.month}`;
  const tied = view.receipts.filter((r) => (r.customer_name ?? "").trim()).length;
  const noPhoto = view.receipts.filter((r) => !r.photos.length).length;
  const excused = view.charges.filter((c) => c.excused_note).length;
  const lines = [
    `${s.receipts} ${s.receipts === 1 ? "receipt" : "receipts"}`,
    s.charges ? `every card charge (${view.totals.charges}) has a receipt${excused ? ` or "no receipt needed"` : ""}` : "no card charges loaded for the month",
    tied ? `${tied} tied to a customer` : "",
    noPhoto ? `${noPhoto} lost ${noPhoto === 1 ? "receipt" : "receipts"} (explained, no photo)` : "",
  ].filter(Boolean);
  return sendEmail({
    to: s.approvers.map((a) => a.email),
    replyTo: s.email,
    subject: `Expense report to approve · ${s.name} · ${label} · ${money(s.total)}`,
    html: wrapEmail(
      "Expense report",
      `<div style="font-size:22px;font-weight:800;margin-bottom:4px;">${h(s.name)}: ${h(label)}</div>
<div style="font-size:14px;color:#52525b;margin-bottom:6px;">${opts.auto ? "Every card charge for the month has a receipt, so AMBIT Intelligence sent it for approval on its own." : `${h(s.name.split(" ")[0])} sent it for approval.`}</div>
<div style="font-size:14px;color:#52525b;margin-bottom:16px;">Total <b style="color:#18181b;">${h(money(s.total))}</b> · AMBIT card ${h(money(s.card))} · Pay back to employee <b style="color:${s.personal > 0 ? "#E33527" : "#18181b"};">${h(money(s.personal))}</b><br>${h(lines.join(" · "))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;margin-bottom:18px;">${catRows(view.totals.byCategory)}</table>
${btn(link, "Review and approve")}
<p style="font-size:12px;color:#71717a;margin:16px 0 0;">Any one approver can approve it. You're getting this because you're an expense approver (Admin → Expense reports).</p>`,
    ),
    text: `Expense report to approve: ${s.name}, ${label}\nTotal ${money(s.total)} (AMBIT card ${money(s.card)}, pay back to employee ${money(s.personal)})\n${lines.join(", ")}\n\nReview and approve: ${link}`,
  });
}

/** To the employee: approved (with the PDF) or sent back (with the note). */
export async function mailReviewed(
  r: { name: string; email: string; month: string; status: "approved" | "returned"; by: string; total: number; personal: number; note: string | null },
  origin: string,
  cc: string[],
  pdf?: EmailAttachment,
): Promise<SendResult> {
  const label = monthLabel(r.month);
  const ok = r.status === "approved";
  const first = r.name.split(" ")[0];
  return sendEmail({
    to: [r.email],
    cc,
    subject: ok ? `Approved: your ${label} expense report (${money(r.total)})` : `Sent back: your ${label} expense report needs a change`,
    html: wrapEmail(
      "Expense report",
      ok
        ? `<div style="font-size:22px;font-weight:800;margin-bottom:6px;">Approved, ${h(first)}</div>
<div style="font-size:14px;color:#52525b;margin-bottom:14px;">${h(r.by)} approved your ${h(label)} expense report: <b style="color:#18181b;">${h(money(r.total))}</b>.${r.personal > 0 ? ` <b style="color:#18181b;">${h(money(r.personal))}</b> you paid yourself will be paid back to you.` : ""}</div>
${r.note ? `<div style="font-size:14px;background:#f4f4f5;border-radius:8px;padding:10px 12px;margin-bottom:14px;">"${h(r.note)}"</div>` : ""}
<p style="font-size:13px;color:#52525b;margin:0;">The approved report is attached.</p>`
        : `<div style="font-size:22px;font-weight:800;margin-bottom:6px;">${h(first)}, your ${h(label)} report needs a change</div>
<div style="font-size:14px;color:#52525b;margin-bottom:10px;">${h(r.by)} sent it back:</div>
<div style="font-size:15px;background:#fef3c7;border-radius:8px;padding:12px 14px;margin-bottom:18px;">${h(r.note ?? "")}</div>
${btn(`${origin}/expenses?m=${r.month}`, "Fix it in AMBIT Intelligence")}
<p style="font-size:12px;color:#71717a;margin:14px 0 0;">When it's fixed, tap Send for approval again.</p>`,
    ),
    text: ok
      ? `${r.by} approved your ${label} expense report: ${money(r.total)}.${r.note ? ` "${r.note}"` : ""} The approved report is attached.`
      : `${r.by} sent back your ${label} expense report: ${r.note}\n\nFix it: ${origin}/expenses?m=${r.month}`,
    attachments: pdf ? [pdf] : undefined,
  });
}

/** To the employee: card charges with no receipt yet (weekly, and when a month is over). */
export async function mailMissing(who: { name: string; email: string }, missing: XCharge[], origin: string, monthOver?: string): Promise<SendResult> {
  const total = missing.reduce((a, c) => a + Number(c.amount), 0);
  const rows = missing
    .slice(0, 20)
    .map(
      (c) =>
        `<tr><td style="padding:6px 0;font-size:13px;color:#71717a;white-space:nowrap;">${h(dateShort(c.txn_date))}</td><td style="padding:6px 8px;font-size:14px;">${h(chargeLabel(c))}</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">${h(money(Number(c.amount)))}</td></tr>`,
    )
    .join("");
  const first = who.name.split(" ")[0];
  const n = missing.length;
  return sendEmail({
    to: [who.email],
    subject: monthOver ? `${monthLabel(monthOver)} is over: ${n} card ${n === 1 ? "charge needs" : "charges need"} a receipt` : `${n} card ${n === 1 ? "charge needs" : "charges need"} a receipt (${money(total)})`,
    html: wrapEmail(
      "Expenses",
      `<div style="font-size:20px;font-weight:800;margin-bottom:6px;">${h(first)}, ${n === 1 ? "this card charge needs" : `these ${n} card charges need`} a receipt</div>
<div style="font-size:14px;color:#52525b;margin-bottom:12px;">${monthOver ? `Your ${h(monthLabel(monthOver))} report can go for approval as soon as these are done.` : "Snap the receipt, or tap the charge and choose Lost receipt to say what it was for."}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;margin-bottom:18px;">${rows}</table>
${btn(`${origin}/expenses${monthOver ? `?m=${monthOver}` : ""}`, "Add the receipts")}`,
    ),
    text: `${n} card charges need a receipt:\n${missing.map((c) => `${c.txn_date}  ${chargeLabel(c)}  ${money(Number(c.amount))}`).join("\n")}\n\n${origin}/expenses`,
  });
}
