import "server-only";
import { DELIVERY_LABEL, dateShort, dateTime, escapeHtml as h, firstName, money, orderNo, qtyText } from "@/lib/format";
import { wrapEmail } from "@/lib/email";
import type { OrderDoc } from "@/lib/order-doc/types";

const td = "padding:6px 0;font-size:14px;font-weight:600;white-space:pre-wrap;";

function whereText(doc: OrderDoc): string {
  const o = doc.order;
  const b = doc.branch ? `${doc.branch.name}, ${doc.branch.state}` : o.branch_id ?? "";
  if (o.delivery_method === "pickup") return `${DELIVERY_LABEL.pickup}: ${b}`;
  return `${DELIVERY_LABEL[o.delivery_method]}${o.delivery_method === "jobsite" && b ? ` (ships from ${b})` : ""}:\n${o.ship_address ?? ""}`;
}

/** One line describing how the customer approved, for emails and the order page. */
export function approvalText(doc: OrderDoc): string | null {
  const o = doc.order;
  if (o.approval_status !== "approved") return null;
  const when = dateTime(o.approved_at);
  if (o.approval_method === "staff_recorded") return `Recorded by ${o.approved_by_name ?? "AMBIT"}: ${o.approval_note ?? ""} (${when})`;
  if (o.approval_method === "in_app") {
    return o.placed_by_role === "customer"
      ? `Placed and approved in the app by ${o.approved_by_name ?? o.placed_by_name ?? "the customer"}, ${when}`
      : `Approved in the app by ${o.approved_by_name ?? "the customer"}, ${when}`;
  }
  return `Approved by ${o.approved_by_name ?? "the customer"} from the emailed link, ${when}`;
}

function itemRows(doc: OrderDoc, withSku = true): string {
  return doc.items
    .map((i) => {
      const price = i.customer_priced
        ? `<span style="color:#b42318;font-weight:700;">Account pricing</span>`
        : i.unit_price === null
          ? `<span style="color:#71717a;">Price TBD</span>`
          : `${money(i.unit_price)} / ${h(i.unit)}`;
      const total = i.line_total === null ? "" : money(i.line_total);
      return `<tr>
${withSku ? `<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:12px;color:#71717a;">${h(i.sku)}</td>` : ""}
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:14px;font-weight:600;">${h(i.name)}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;">${h(qtyText(Number(i.qty), i.unit))}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right;white-space:nowrap;">${price}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;">${total}</td></tr>`;
    })
    .join("");
}

function itemsTable(doc: OrderDoc, withSku = true): string {
  const cols = withSku ? 4 : 3;
  const th = (t: string, align = "left") => `<th align="${align}" style="padding:8px;font-size:11px;letter-spacing:1px;">${t}</th>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;">
<tr style="background:#0A0A0B;color:#ffffff;">${withSku ? th("SKU") : ""}${th("ITEM")}${th("QTY", "right")}${th("PRICE", "right")}${th("TOTAL", "right")}</tr>
${itemRows(doc, withSku)}
<tr><td colspan="${cols}" style="padding:12px 8px;text-align:right;font-size:13px;color:#71717a;">Estimated list-price subtotal</td>
<td style="padding:12px 8px;text-align:right;font-size:15px;font-weight:800;">${money(doc.order.est_subtotal)}</td></tr>
</table>`;
}

function detailTable(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;width:120px;color:#71717a;font-size:13px;vertical-align:top;">${h(k)}</td><td style="${td}">${h(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

const button = (href: string, label: string) =>
  `<a href="${h(href)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">${h(label)}</a>`;

/** The order for orders@ambitpu.com (sent once it's approved, or right away when approval isn't needed). */
export function buildOrderEmail(doc: OrderDoc, link: string) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const who = o.account_no ? `${o.company_name} (${o.account_no})` : o.company_name;
  const approved = approvalText(doc);
  const subject = `New order ${no} · ${who}${o.po_number ? ` · PO ${o.po_number}` : ""}${approved ? " · approved" : ""}`;

  const rows: [string, string][] = [
    ["Order", no],
    ["Customer", who],
    [
      "Placed by",
      [o.placed_by_name, o.placed_by_email, o.placed_by_phone].filter(Boolean).join(" · ") + (o.placed_by_role !== "customer" ? " (AMBIT)" : ""),
    ],
    ["Submitted", dateTime(o.created_at)],
    ["Delivery", whereText(doc)],
    ["PO number", o.po_number ?? "-"],
    ["Needed by", o.needed_by ? dateShort(o.needed_by) : "-"],
  ];
  if (approved) rows.push(["Approval", approved]);
  if (o.notes) rows.push(["Notes", o.notes]);

  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">${approved ? "APPROVED ORDER" : "ORDER REQUEST"}</div>
<div style="font-size:26px;font-weight:800;margin:4px 0 16px;">${h(no)} · ${h(o.company_name)}</div>
${detailTable(rows)}
${itemsTable(doc)}
${o.has_customer_pricing ? `<p style="font-size:13px;color:#b42318;margin:8px 0 0;">Includes items at account pricing. Apply the account's pricing on the invoice.</p>` : ""}
<p style="font-size:13px;color:#52525b;margin:16px 0 0;">The printable order is attached as a PDF. Final pricing, tax and freight are confirmed by AMBIT on the invoice.</p>
<p style="margin:20px 0 0;">${button(link, "OPEN IN AMBITION")}</p>`;

  const text = [
    `${approved ? "APPROVED ORDER" : "ORDER REQUEST"} ${no}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Items:",
    ...doc.items.map(
      (i) =>
        `- ${i.sku}  ${i.name}  x ${qtyText(Number(i.qty), i.unit)}  ${
          i.customer_priced ? "Account pricing" : i.unit_price === null ? "Price TBD" : `${money(i.unit_price)}/${i.unit}`
        }${i.line_total !== null ? `  = ${money(i.line_total)}` : ""}`,
    ),
    "",
    `Estimated list-price subtotal: ${money(o.est_subtotal)}`,
    "The printable order is attached as a PDF. Final pricing, tax and freight are confirmed by AMBIT on the invoice.",
    "",
    link,
  ].join("\n");

  return { subject, html: wrapEmail(approved ? "Approved order" : "Order request", inner), text };
}

/** To the customer: please check and approve the order AMBIT put together for you. */
export function buildApprovalRequestEmail(doc: OrderDoc, approveUrl: string) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const rep = o.placed_by_name ?? "Your AMBIT rep";
  const hello = doc.company?.contact_name ? `Hi ${firstName(doc.company.contact_name)},` : "Hello,";
  const until = o.approval_expires_at ? dateShort(o.approval_expires_at) : "7 days from now";
  const subject = `Please approve your AMBIT order ${no}${o.po_number ? ` (PO ${o.po_number})` : ""}`;
  const contact = [o.placed_by_phone, o.placed_by_email].filter(Boolean).join(" or ");

  const rows: [string, string][] = [
    ["Order", no],
    ["For", o.account_no ? `${o.company_name} (${o.account_no})` : o.company_name],
    ["Delivery", whereText(doc)],
    ["PO number", o.po_number ?? "-"],
    ["Needed by", o.needed_by ? dateShort(o.needed_by) : "-"],
  ];
  if (o.notes) rows.push(["Notes", o.notes]);

  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">ORDER FOR YOUR APPROVAL</div>
<div style="font-size:26px;font-weight:800;margin:4px 0 14px;">${h(no)} · ${h(o.company_name)}</div>
<p style="font-size:15px;margin:0 0 10px;">${h(hello)}</p>
<p style="font-size:15px;margin:0 0 16px;line-height:1.5;">${h(rep)} at AMBIT put together this order for ${h(o.company_name)}. Please check the items, quantities and delivery details, then approve it. <b>Nothing is picked or shipped until you approve.</b></p>
<p style="margin:0 0 22px;">${button(approveUrl, "REVIEW AND APPROVE")}</p>
${detailTable(rows)}
${itemsTable(doc, false)}
<p style="font-size:13px;color:#52525b;margin:16px 0 0;line-height:1.5;">Something not right? Open the link and tap <b>Request changes</b>, or contact ${h(rep)}${contact ? ` at ${h(contact)}` : ""}. The link works until ${h(until)}. The order is attached as a PDF if you'd like to print it.</p>`;

  const text = [
    `ORDER FOR YOUR APPROVAL ${no}`,
    "",
    hello,
    `${rep} at AMBIT put together this order for ${o.company_name}. Please check it and approve it. Nothing is picked or shipped until you approve.`,
    "",
    `Review and approve: ${approveUrl}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Items:",
    ...doc.items.map((i) => `- ${i.name}  x ${qtyText(Number(i.qty), i.unit)}${i.line_total !== null ? `  ${money(i.line_total)}` : i.customer_priced ? "  Account pricing" : ""}`),
    "",
    `Something not right? Open the link and tap Request changes, or contact ${rep}${contact ? ` at ${contact}` : ""}. The link works until ${until}.`,
  ].join("\n");

  return { subject, html: wrapEmail("Approval needed", inner), text };
}

/** To the rep: the customer asked for changes instead of approving. */
export function buildChangeRequestEmail(doc: OrderDoc, link: string) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const subject = `Changes requested · ${no} · ${o.company_name}`;
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">CHANGES REQUESTED</div>
<div style="font-size:26px;font-weight:800;margin:4px 0 16px;">${h(no)} · ${h(o.company_name)}</div>
<p style="font-size:15px;margin:0 0 10px;">The customer didn't approve this order yet. They asked for:</p>
<div style="font-size:15px;white-space:pre-wrap;background:#fafafa;border-left:4px solid #E33527;padding:12px 14px;margin:0 0 16px;">${h(o.approval_note ?? "")}</div>
<p style="font-size:14px;color:#52525b;margin:0 0 18px;line-height:1.5;">To fix it: open the order, tap <b>Reorder these items</b> to start a corrected copy, adjust it and send that one for approval. Then cancel ${h(no)}.</p>
<p style="margin:0;">${button(link, "OPEN THE ORDER")}</p>`;
  const text = [`CHANGES REQUESTED ${no} · ${o.company_name}`, "", o.approval_note ?? "", "", link].join("\n");
  return { subject, html: wrapEmail("Changes requested", inner), text };
}
