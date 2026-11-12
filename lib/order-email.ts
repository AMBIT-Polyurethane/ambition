import "server-only";
import { NOT_ORDER_FINE, NOT_ORDER_TITLE } from "@/lib/order-doc/wording";
import { DELIVERY_LABEL, dateShort, dateTime, escapeHtml as h, firstName, money, orderNo, plural, qtyText } from "@/lib/format";
import { foamLoads, rowPrice, splitNote } from "@/lib/order-doc/loads";
import { wrapEmail } from "@/lib/email";
import type { OrderDoc } from "@/lib/order-doc/types";
import type { AddonPick } from "@/lib/order-addons";

const td = "padding:6px 0;font-size:14px;font-weight:600;white-space:pre-wrap;";

function whereText(doc: OrderDoc): string {
  const o = doc.order;
  const b = doc.branch ? `${doc.branch.name}, ${doc.branch.state}` : o.branch_id ?? "";
  if (o.delivery_method === "pickup") return `${DELIVERY_LABEL.pickup}: ${b}`;
  return `${DELIVERY_LABEL[o.delivery_method]}${o.delivery_method === "jobsite" && b ? ` (ships from ${b})` : ""}:\n${o.ship_address ?? ""}`;
}

/** One line describing how the customer approved, for emails and the order page. */
// The customer's emails say what the order form is (and isn't), with the fine print under it.
const notOrderHtml = `<div style="margin:16px 0 0;padding:10px 12px;border:1.5px solid #E33527;border-radius:8px;">
<div style="font-size:13px;font-weight:800;letter-spacing:1px;color:#E33527;">${NOT_ORDER_TITLE}</div>
<div style="font-size:11px;line-height:1.5;color:#71717a;margin-top:3px;">${NOT_ORDER_FINE}</div></div>`;

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
  // Spray foam grouped by load (ISO with its resin), with a dark line between groups, like the PDF.
  return foamLoads(doc.items)
    .flatMap((g, gi) => g.rows.map((row, ri) => ({ row, i: row.item, brk: gi > 0 && ri === 0 })))
    .map(({ row, i, brk }) => {
      const price = i.customer_priced
        ? `<span style="color:#b42318;font-weight:700;">Account pricing</span>`
        : i.unit_price === null
          ? `<span style="color:#71717a;">Price TBD</span>`
          : `${money(i.unit_price)} / ${h(i.unit)}`;
      const total = i.line_total === null ? "" : money(rowPrice(i, row).total);
      const note = splitNote(row, plural(i.unit, 2));
      const top = brk ? "border-top:2px solid #18181b;" : "";
      return `<tr>
${withSku ? `<td style="padding:10px 8px;border-bottom:1px solid #eee;${top}font-size:12px;color:#71717a;">${h(i.sku)}</td>` : ""}
<td style="padding:10px 8px;border-bottom:1px solid #eee;${top}font-size:14px;font-weight:600;">${h(i.name)}${note ? `<div style="font-size:12px;font-weight:400;color:#71717a;margin-top:2px;">${h(note)}</div>` : ""}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;${top}font-size:14px;text-align:right;white-space:nowrap;">${h(qtyText(row.qty, i.unit))}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;${top}font-size:13px;text-align:right;white-space:nowrap;">${price}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eee;${top}font-size:14px;text-align:right;white-space:nowrap;">${total}</td></tr>`;
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
/** A list of what changed, as an HTML box (edits to an order). */
function changesBox(changes: string[], title = "What changed"): string {
  if (!changes.length) return "";
  return `<div style="margin:16px 0 0;padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;">
<div style="font-size:12px;font-weight:800;letter-spacing:1px;color:#9a3412;">${h(title.toUpperCase())}</div>
<ul style="margin:6px 0 0;padding-left:18px;font-size:14px;line-height:1.6;">${changes.map((c) => `<li>${h(c)}</li>`).join("")}</ul></div>`;
}

export function buildOrderEmail(doc: OrderDoc, link: string, updated?: { changes: string[] }) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const who = o.account_no ? `${o.company_name} (${o.account_no})` : o.company_name;
  const approved = approvalText(doc);
  const rev = (o as { revision?: number }).revision ?? 1;
  const subject = updated
    ? `Updated order ${no} (revision ${rev}) · ${who}${o.po_number ? ` · PO ${o.po_number}` : ""}`
    : `New order ${no} · ${who}${o.po_number ? ` · PO ${o.po_number}` : ""}${approved ? " · approved" : ""}`;

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
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">${updated ? `UPDATED ORDER · REVISION ${rev}` : approved ? "APPROVED ORDER" : "ORDER REQUEST"}</div>
<div style="font-size:26px;font-weight:800;margin:4px 0 16px;">${h(no)} · ${h(o.company_name)}</div>
${updated ? changesBox(updated.changes) : ""}
${detailTable(rows)}
${itemsTable(doc)}
${o.has_customer_pricing ? `<p style="font-size:13px;color:#b42318;margin:8px 0 0;">Includes items at account pricing. Apply the account's pricing on the invoice.</p>` : ""}
<p style="font-size:13px;color:#52525b;margin:16px 0 0;">The printable order is attached as a PDF. Final pricing, tax and freight are confirmed by AMBIT on the invoice.</p>
<p style="margin:20px 0 0;">${button(link, "OPEN IN AMBIT A.I.")}</p>`;

  const text = [
    `${updated ? `UPDATED ORDER (revision ${rev})` : approved ? "APPROVED ORDER" : "ORDER REQUEST"} ${no}`,
    ...(updated ? ["What changed:", ...updated.changes.map((c) => `- ${c}`), ""] : []),
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

  return { subject, html: wrapEmail(updated ? "Updated order" : approved ? "Approved order" : "Order request", inner), text };
}

/** To the customer: the order was changed and AMBIT's invoice is updated. */
export function buildOrderUpdatedEmail(doc: OrderDoc, changes: string[]) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const rev = (o as { revision?: number }).revision ?? 1;
  const hello = doc.company?.contact_name ? `Hi ${firstName(doc.company.contact_name)},` : "Hello,";
  const rep = o.placed_by_role !== "customer" ? o.placed_by_name : null;
  const subject = `Your AMBIT order ${no} was updated`;
  const rows: [string, string][] = [
    ["Order", `${no} (revision ${rev})`],
    ["Delivery", whereText(doc)],
    ["Your PO", o.po_number ?? "-"],
  ];
  if (o.scheduled_for) rows.push([o.delivery_method === "pickup" ? "Pickup" : "Delivery date", dateShort(o.scheduled_for)]);
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">UPDATED ORDER</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 14px;">${h(no)} · ${h(o.company_name)}</div>
<p style="font-size:15px;margin:0 0 10px;">${h(hello)}</p>
<p style="font-size:15px;margin:0 0 6px;line-height:1.5;">Your order ${h(no)} was updated and AMBIT's invoice now matches it. The updated order is attached as a PDF.</p>
${changesBox(changes)}
<div style="height:12px;"></div>
${detailTable(rows)}
${itemsTable(doc, false)}
${notOrderHtml}
<p style="font-size:13px;color:#52525b;margin:10px 0 0;line-height:1.5;">Something not right? Reply to this email${rep ? ` or contact ${h(rep)}` : ""}, or call AMBIT at (817) 677-1200.</p>`;
  const text = [
    `UPDATED ORDER ${no} (revision ${rev})`,
    "",
    hello,
    `Your order ${no} was updated and AMBIT's invoice now matches it.`,
    "",
    "What changed:",
    ...changes.map((c) => `- ${c}`),
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `${NOT_ORDER_TITLE}.`,
    NOT_ORDER_FINE,
  ].join("\n");
  return { subject, html: wrapEmail("Updated order", inner), text };
}

/** To the customer: please check and approve the order AMBIT put together for you. */
/** "Popular at OKC: add to this order" (0065): the location's most ordered items, each linking to the add page. */
function addonsHtml(picks: AddonPick[], addUrl: string, branchName: string): string {
  if (!picks.length) return "";
  const rows = picks
    .map(
      (p) => `<tr>
<td style="padding:9px 8px;border-bottom:1px solid #e4e4e7;"><b style="font-size:14px;">${h(p.name)}</b><br><span style="font-size:12px;color:#71717a;">${h(p.sku)}</span></td>
<td style="padding:9px 8px;border-bottom:1px solid #e4e4e7;text-align:right;font-size:14px;white-space:nowrap;">${p.account || p.price === null ? '<span style="color:#71717a;">Account pricing</span>' : `<b>${h(money(p.price))}</b> <span style="font-size:12px;color:#71717a;">/ ${h(p.unit)}</span>`}</td>
<td style="padding:9px 8px;border-bottom:1px solid #e4e4e7;text-align:right;"><a href="${h(`${addUrl}?add=${p.id}`)}" style="display:inline-block;border:1.5px solid #E33527;color:#E33527;text-decoration:none;font-weight:800;font-size:12px;letter-spacing:1px;padding:6px 12px;border-radius:6px;">ADD</a></td>
</tr>`,
    )
    .join("");
  return `<div style="margin:24px 0 0;padding:16px;border-radius:10px;background:#fafafa;border:1px solid #e4e4e7;">
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">NEED ANYTHING ELSE?</div>
<div style="font-size:17px;font-weight:800;margin:4px 0 6px;">Most ordered at ${h(branchName)}</div>
<p style="font-size:13px;color:#52525b;margin:0 0 8px;line-height:1.5;">Add any of these to this order before you approve it. They go on the same pickup or delivery.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
<p style="margin:14px 0 0;">${button(addUrl, "ADD ITEMS TO THIS ORDER")}</p>
</div>`;
}

export function buildApprovalRequestEmail(doc: OrderDoc, approveUrl: string, addons: AddonPick[] = []) {
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
${addonsHtml(addons, `${approveUrl}/add`, doc.branch ? doc.branch.name : "AMBIT")}
${notOrderHtml}
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
    ...(addons.length ? ["", `Need anything else? Most ordered at ${doc.branch ? doc.branch.name : "AMBIT"} (add them here: ${approveUrl}/add):`, ...addons.map((p) => `- ${p.name}  ${p.account || p.price === null ? "Account pricing" : `${money(p.price)} / ${p.unit}`}`)] : []),
    "",
    `${NOT_ORDER_TITLE}.`,
    NOT_ORDER_FINE,
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

export type DeskNotice = "credit_needed" | "credit_hold" | "ready_to_schedule" | "invoice_update" | "corrected";

/** Order desk heads-ups for AMBIT staff: the order is now in their queue. */
export function buildDeskEmail(kind: DeskNotice, doc: OrderDoc, link: string, changes?: string[]) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const who = o.account_no ? `${o.company_name} (${o.account_no})` : o.company_name;
  const ox = o as { revision?: number; invoice_update_by_name?: string | null };
  const recheck = kind === "credit_needed" && /^Check again/.test(o.credit_note ?? "");
  const head = {
    credit_needed: recheck
      ? { eyebrow: "CREDIT CHECK AGAIN", subject: `Credit check again (order edited) · ${no} · ${o.company_name}`, line: `${o.credit_note} The order desk updated the invoice (Invoice # ${o.invoice_no ?? ""}). Check for credit holds, then release the order or put it on hold.` }
      : { eyebrow: "CREDIT CHECK NEEDED", subject: `Credit check needed · ${no} · ${o.company_name}`, line: `${o.po_by_name ?? "The order desk"} entered Sales Order # ${o.ambit_po ?? ""}${o.invoice_no ? ` and Invoice # ${o.invoice_no}` : ""}. Check for credit holds, then release the order or put it on hold.` },
    invoice_update: { eyebrow: "INVOICE UPDATE NEEDED", subject: `Invoice update needed · ${no} · ${o.company_name}`, line: `${ox.invoice_update_by_name ?? "AMBIT staff"} ${o.status === "completed" ? "corrected this order after it was " + (o.delivery_method === "pickup" ? "picked up" : "shipped out") : "edited this order"} (now revision ${ox.revision ?? 2}). Update the invoice in QuickBooks, then enter the new Invoice # and the prices on the order in the app.` },
    corrected: { eyebrow: "SETTLE THE DIFFERENCE", subject: `Corrected after ${o.delivery_method === "pickup" ? "pickup" : "delivery"} · ${no} · ${o.company_name}`, line: `This order was corrected after it was ${o.delivery_method === "pickup" ? "picked up" : "shipped out"}, and the order desk updated the invoice (Invoice # ${o.invoice_no ?? ""}). Collect the difference from the customer if the total went up, or credit them if it went down. Credit isn't checked again.` },
    credit_hold: { eyebrow: "ON CREDIT HOLD", subject: `On credit hold · ${no} · ${o.company_name}`, line: `${o.credit_by_name ?? "Accounting"} put this order on hold: ${o.credit_note ?? ""}` },
    ready_to_schedule: { eyebrow: "READY TO SCHEDULE", subject: `Ready to schedule · ${no} · ${o.company_name}`, line: `${o.credit_by_name ?? "Accounting"} released this order. Set the ${o.delivery_method === "pickup" ? "pickup" : "delivery"} date and the customer is emailed.` },
  }[kind];
  const rows: [string, string][] = [
    ["Order", no],
    ["Customer", who],
    ["Sales Order #", o.ambit_po ?? "-"],
    ["Invoice #", o.invoice_no ?? "-"],
    ["Customer PO", o.po_number ?? "-"],
    ["Delivery", whereText(doc)],
    ["Needed by", o.needed_by ? dateShort(o.needed_by) : "-"],
    ["Subtotal", `${money(o.est_subtotal)}${o.has_customer_pricing ? " + account-priced items" : ""}`],
  ];
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">${head.eyebrow}</div>
<div style="font-size:26px;font-weight:800;margin:4px 0 12px;">${h(no)} · ${h(o.company_name)}</div>
<p style="font-size:15px;margin:0 0 16px;line-height:1.5;">${h(head.line)}</p>
${changes?.length ? changesBox(changes) + '<div style="height:12px;"></div>' : ""}
${detailTable(rows)}
<p style="margin:20px 0 0;">${button(link, "OPEN THE ORDER")}</p>`;
  const text = [head.eyebrow + " " + no, head.line, "", ...(changes?.length ? ["What changed:", ...changes.map((c) => `- ${c}`), ""] : []), ...rows.map(([k, v]) => `${k}: ${v}`), "", link].join("\n");
  return { subject: head.subject, html: wrapEmail("Order desk", inner), text };
}

/** To the customer: approved and scheduled, with the date. */
export function buildScheduledEmail(doc: OrderDoc) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const pickup = o.delivery_method === "pickup";
  const when = o.scheduled_for ? new Date(o.scheduled_for + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "";
  const branch = doc.branch ? `AMBIT ${doc.branch.name} branch${doc.branch.address ? `, ${doc.branch.address}` : ""}` : "your AMBIT branch";
  const headline = pickup ? `Ready for pickup ${when}` : `Scheduled for delivery ${when}`;
  const subject = `Your AMBIT order ${no} is approved and scheduled · ${o.scheduled_for ? dateShort(o.scheduled_for) : ""}`;
  const hello = doc.company?.contact_name ? `Hi ${firstName(doc.company.contact_name)},` : "Hello,";
  const rep = o.placed_by_role !== "customer" ? o.placed_by_name : null;
  const rows: [string, string][] = [
    ["Order", no],
    [pickup ? "Pickup" : "Delivery", pickup ? `${when}\n${branch}` : `${when}\n${o.ship_address ?? ""}`],
    ["Your PO", o.po_number ?? "-"],
  ];
  if (o.schedule_note) rows.push(["Note from AMBIT", o.schedule_note]);
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#15803d;">APPROVED AND SCHEDULED</div>
<div style="font-size:24px;font-weight:800;margin:4px 0 14px;">${h(headline)}</div>
<p style="font-size:15px;margin:0 0 10px;">${h(hello)}</p>
<p style="font-size:15px;margin:0 0 16px;line-height:1.5;">Your order ${h(no)} for ${h(o.company_name)} is approved and scheduled. Details are below and the order is attached as a PDF.</p>
${detailTable(rows)}
${itemsTable(doc, false)}
${notOrderHtml}
<p style="font-size:13px;color:#52525b;margin:10px 0 0;line-height:1.5;">Questions or a change of plans? Reply to this email${rep ? ` or contact ${h(rep)}` : ""}, or call AMBIT at (817) 677-1200.</p>`;
  const text = [
    `APPROVED AND SCHEDULED: ${headline}`,
    "",
    hello,
    `Your order ${no} for ${o.company_name} is approved and scheduled.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `${NOT_ORDER_TITLE}.`,
    NOT_ORDER_FINE,
  ].join("\n");
  return { subject, html: wrapEmail("Order scheduled", inner), text };
}
