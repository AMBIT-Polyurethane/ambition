import "server-only";
import { DELIVERY_LABEL, dateShort, dateTime, escapeHtml as h, money, orderNo, qtyText } from "@/lib/format";
import { wrapEmail } from "@/lib/email";
import type { Branch, Order, OrderItem } from "@/lib/types";

export function buildOrderEmail(order: Order, items: OrderItem[], branch: Branch | null, link: string) {
  const no = orderNo(order.order_no);
  const who = order.account_no ? `${order.company_name} (${order.account_no})` : order.company_name;
  const subject = `New order ${no} · ${who}${order.po_number ? ` · PO ${order.po_number}` : ""}`;

  const where =
    order.delivery_method === "pickup"
      ? `${DELIVERY_LABEL.pickup}: ${branch ? `${branch.name}, ${branch.state}` : order.branch_id ?? ""}`
      : `${DELIVERY_LABEL[order.delivery_method]}: ${order.ship_address ?? ""}`;

  const rows: [string, string][] = [
    ["Order", no],
    ["Customer", who],
    ["Placed by", [order.placed_by_name, order.placed_by_email, order.placed_by_phone].filter(Boolean).join(" · ") +
      (order.placed_by_role !== "customer" ? " (AMBIT)" : "")],
    ["Submitted", dateTime(order.created_at)],
    ["Delivery", where],
    ["PO number", order.po_number ?? "-"],
    ["Needed by", order.needed_by ? dateShort(order.needed_by) : "-"],
  ];
  if (order.notes) rows.push(["Notes", order.notes]);

  const detail = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;width:120px;color:#71717a;font-size:13px;vertical-align:top;">${h(k)}</td><td style="padding:6px 0;font-size:14px;font-weight:600;white-space:pre-wrap;">${h(v)}</td></tr>`,
    )
    .join("");

  const lines = items
    .map((i) => {
      const price = i.customer_priced
        ? `<span style="color:#b42318;font-weight:700;">Customer pricing</span>`
        : i.unit_price === null
          ? `<span style="color:#71717a;">Price TBD</span>`
          : `${money(i.unit_price)} / ${h(i.unit)}`;
      const total = i.line_total === null ? "" : money(i.line_total);
      return `<tr>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:12px;color:#71717a;">${h(i.sku)}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:14px;font-weight:600;">${h(i.name)}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;">${h(qtyText(i.qty, i.unit))}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right;white-space:nowrap;">${price}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;">${total}</td></tr>`;
    })
    .join("");

  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">ORDER REQUEST</div>
<div style="font-size:26px;font-weight:800;margin:4px 0 16px;">${h(no)} · ${h(order.company_name)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detail}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;">
<tr style="background:#0A0A0B;color:#ffffff;">
<th align="left" style="padding:8px;font-size:11px;letter-spacing:1px;">SKU</th>
<th align="left" style="padding:8px;font-size:11px;letter-spacing:1px;">ITEM</th>
<th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">QTY</th>
<th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">PRICE</th>
<th align="right" style="padding:8px;font-size:11px;letter-spacing:1px;">TOTAL</th></tr>
${lines}
<tr><td colspan="4" style="padding:12px 8px;text-align:right;font-size:13px;color:#71717a;">Estimated list-price subtotal</td>
<td style="padding:12px 8px;text-align:right;font-size:15px;font-weight:800;">${money(order.est_subtotal)}</td></tr>
</table>
${order.has_customer_pricing ? `<p style="font-size:13px;color:#b42318;margin:8px 0 0;">Includes items at customer pricing. Apply the account's pricing on the invoice.</p>` : ""}
<p style="font-size:13px;color:#52525b;margin:16px 0 0;">Final pricing, tax and freight are confirmed by AMBIT on the invoice.</p>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:12px 18px;border-radius:8px;">OPEN IN AMBITION</a></p>`;

  const text = [
    `ORDER REQUEST ${no}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Items:",
    ...items.map(
      (i) =>
        `- ${i.sku}  ${i.name}  x ${qtyText(i.qty, i.unit)}  ${
          i.customer_priced ? "Customer pricing" : i.unit_price === null ? "Price TBD" : `${money(i.unit_price)}/${i.unit}`
        }${i.line_total !== null ? `  = ${money(i.line_total)}` : ""}`,
    ),
    "",
    `Estimated list-price subtotal: ${money(order.est_subtotal)}`,
    "Final pricing, tax and freight are confirmed by AMBIT on the invoice.",
    "",
    link,
  ].join("\n");

  return { subject, html: wrapEmail("Order request", inner), text };
}
