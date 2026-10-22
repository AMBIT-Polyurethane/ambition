import "server-only";
import { escapeHtml as h } from "@/lib/format";
import { wrapEmail } from "@/lib/email";
import type { PriceRow } from "@/lib/jotform";

/** To the sales rep: the manager's approved prices for their request. */
export function buildPrfApprovedEmail(input: { customer: string; contact: string; rows: PriceRow[]; note: string; approver: string; link: string }) {
  const rows = input.rows.filter((r) => r.requested || r.approved);
  const subject = `Approved prices · ${input.customer || input.contact || "price request"}`;
  const table = rows
    .map(
      (r) => `<tr>
<td style="padding:9px 8px;border-bottom:1px solid #eee;font-size:14px;font-weight:600;">${h(r.product)}</td>
<td style="padding:9px 8px;border-bottom:1px solid #eee;font-size:13px;color:#71717a;text-align:right;white-space:nowrap;">${h(r.requested || "-")}</td>
<td style="padding:9px 8px;border-bottom:1px solid #eee;font-size:15px;font-weight:800;text-align:right;white-space:nowrap;">${h(r.approved || "-")}</td></tr>`,
    )
    .join("");
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#15803d;">PRICES APPROVED</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 6px;">${h(input.customer || input.contact)}</div>
${input.customer && input.contact ? `<div style="font-size:14px;color:#52525b;margin-bottom:14px;">${h(input.contact)}</div>` : ""}
<p style="font-size:15px;margin:0 0 14px;line-height:1.5;">${h(input.approver)} approved pricing for your request.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="background:#0A0A0B;color:#ffffff;"><th align="left" style="padding:8px;font-size:11px;letter-spacing:1px;">PRODUCT</th><th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">REQUESTED</th><th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">APPROVED</th></tr>
${table}
</table>
${input.note ? `<div style="font-size:14px;white-space:pre-wrap;background:#fafafa;border-left:4px solid #15803d;padding:12px 14px;margin:16px 0 0;">${h(input.note)}</div>` : ""}
<p style="margin:20px 0 0;"><a href="${h(input.link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:12px 18px;border-radius:8px;">OPEN IN AMBITION</a></p>`;
  const text = [
    `PRICES APPROVED: ${input.customer || input.contact}`,
    `${input.approver} approved pricing for your request.`,
    "",
    ...rows.map((r) => `- ${r.product}: requested ${r.requested || "-"}, approved ${r.approved || "-"}`),
    input.note ? `\nNote: ${input.note}` : "",
    "",
    input.link,
  ].join("\n");
  return { subject, html: wrapEmail("Price request", inner), text };
}
