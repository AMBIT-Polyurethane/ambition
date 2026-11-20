"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { canEmailCustomers, sendEmail } from "@/lib/email";
import { ORDERS_EMAIL, siteUrl } from "@/lib/env";
import { estimateFor, intakeAdcOrder, priceForCustomer, type Intake } from "@/lib/adc-intake";
import type { Strategy } from "@/lib/adc-logistics";

export type AdcOrderInput = {
  name: string;
  company: string;
  email: string;
  phone: string;
  delivery: "ship" | "pickup" | "truckload";
  pickup_branch: string;
  address: { street: string; street2: string; city: string; state: string; zip: string };
  notes: string;
  website?: string;
  /** The store's language when they ordered (es: the customer's email is in Spanish). */
  lang?: "en" | "es" | "zh";
  /** Email me deals (checked unless they untick it). */
  promo_opt_in?: boolean;
  /** Signed in: use their AM-BUCKS on this order (AMBIT takes them off when it confirms the total). */
  use_bucks?: boolean;
  items: { product_id?: string | null; sku?: string; name?: string; qty: number }[];
  /** Current AMBIT customer (matched by name + phone or account # on file) or someone new (added to A.I.). */
  customer?: {
    kind: "account" | "new";
    check: string;
    bill_same: boolean;
    bill: { street: string; city: string; state: string; zip: string };
    tax_exempt: boolean;
    site: "business" | "home";
    unload: "dock" | "forklift" | "liftgate";
    /** When they can take a delivery (goes on the order notes). */
    hours?: string;
  };
};
export type AdcOrderResult = { ok: true; order_no: string } | { ok: false; error: string };

type Line = { product_id?: string | null; sku: string; name: string; unit: string | null; qty: number; price: number | null; list_price?: number | null; on_sale?: boolean; promo?: string | null; set?: boolean; ship?: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

const MATCH: Record<Intake["match"], string> = {
  verified: "CURRENT AMBIT CUSTOMER: matched by business name (double-check it's them)",
  unverified: "NOT VERIFIED: treat as prepay until you confirm who they are",
  new: "NEW CUSTOMER",
  added: "NEW CUSTOMER: added to A.I. (Pays in advance, needs QuickBooks setup)",
};

/** The BIG RED ALERT at the top of the order email: what the order desk must do before this ships. */
function redAlert(i: Intake | null): string {
  const list = i ? i.red : ["Check this customer by hand."];
  if (!list.length) return "";
  return `<div style="margin:0 0 18px;padding:16px 18px;border:3px solid #C8102E;background:#FDECEE;border-radius:10px;">
<div style="font-size:20px;font-weight:900;color:#C8102E;letter-spacing:0.5px;margin:0 0 8px;">&#9888; ACTION NEEDED BEFORE THIS SHIPS</div>
${list.map((x) => `<div style="font-size:15px;font-weight:700;color:#7A0A1A;margin:6px 0;">${esc(x)}</div>`).join("")}
</div>`;
}

const KIND: Record<string, string> = { parcel: "Parcel (UPS/FedEx Ground)", ltl: "LTL freight", truck: "Full truck", vendor: "Vendor", pickup: "Pick up" };

/** Customer details and the Best Strategy summary for the order desk. */
function staffBlocks(o: AdcOrderInput, i: Intake | null, id: number): string {
  const c = o.customer;
  const b = c && !c.bill_same ? c.bill : o.delivery !== "pickup" ? o.address : null;
  const who = `<div style="margin:18px 0 0;padding:14px 16px;background:#f4f4f2;border-radius:10px;font-size:14px;">
<b>Customer:</b> ${i ? esc(MATCH[i.match]) : "Check by hand"}${i?.company ? ` · A.I. customer: <b>${esc(i.company.name)}</b>${i.company.account_no ? ` (acct ${esc(i.company.account_no)})` : ""}` : ""}<br>
${c?.kind === "account" ? "They said they're a current AMBIT customer.<br>" : ""}
<b>Billing:</b> ${b ? `${esc(b.street)}, ${esc(b.city)}, ${esc(b.state.toUpperCase())} ${esc(b.zip)}` : "not given"}${c?.bill_same && o.delivery !== "pickup" ? " (same as shipping)" : ""}<br>
<b>Delivery site:</b> ${c?.site === "home" ? "home / job site" : "business"} · <b>Unloading:</b> ${c?.unload === "liftgate" ? "no dock or forklift: LIFTGATE" : c?.unload === "forklift" ? "forklift" : "loading dock"}
${i?.alerts.length ? `<div style="margin:8px 0 0;">${i.alerts.map((a) => `<div style="color:#8a4b00;font-weight:700;">&#9679; ${esc(a)}</div>`).join("")}</div>` : ""}
</div>`;
  const s: Strategy | null | undefined = i?.strategy;
  const best = s?.options.find((x) => x.key === s.best);
  if (!s || !best) return who;
  const rows = best.shipments
    .map(
      (x) => `<tr><td style="padding:6px;border-bottom:1px solid #eee;">${esc(x.fromName)}</td><td style="padding:6px;border-bottom:1px solid #eee;">${KIND[x.kind] ?? x.kind}</td>
<td style="padding:6px;border-bottom:1px solid #eee;">${x.lines.map((l) => `${l.qty} x ${esc(l.sku)}`).join(", ")}</td>
<td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${Math.round(x.weight).toLocaleString("en-US")} lb${x.miles ? ` · ${x.miles.toLocaleString("en-US")} mi` : ""}</td>
<td style="padding:6px;border-bottom:1px solid #eee;text-align:right;font-weight:700;">${x.cost === null ? "quote" : usd(x.cost)}</td></tr>`,
    )
    .join("");
  const others = s.options.filter((x) => x.key !== best.key && x.ok);
  return `${who}
<div style="margin:18px 0 0;padding:14px 16px;border:2px solid #0A0A0B;border-radius:10px;">
<div style="font-size:16px;font-weight:900;margin:0 0 4px;">BEST STRATEGY: ${esc(best.title)}</div>
<div style="font-size:13px;color:#55555c;margin:0 0 8px;">${Math.round(s.weight).toLocaleString("en-US")} lb in all · ${esc(best.days)}${s.estimate !== null && o.delivery !== "pickup" ? ` · customer was shown <b>${usd(s.estimate)}</b> estimated shipping` : ""}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
<tr style="background:#f4f4f2;"><th align="left" style="padding:6px;">From</th><th align="left" style="padding:6px;">How</th><th align="left" style="padding:6px;">What</th><th align="right" style="padding:6px;">Weight</th><th align="right" style="padding:6px;">Est.</th></tr>
${rows}</table>
${best.transfers.length ? `<div style="margin:8px 0 0;font-size:13px;"><b>Transfers first${best.transferCost ? ` (about ${usd(best.transferCost)} of freight to us)` : ""}:</b> ${best.transfers.map((t) => `${t.qty} x ${esc(t.sku)} ${esc(t.fromName)} &#8594; ${esc(t.toName)}`).join("; ")}</div>` : ""}
${others.length ? `<div style="margin:8px 0 0;font-size:13px;color:#55555c;"><b>Other options:</b> ${others.map((x) => `${esc(x.title)} (${x.total === null ? "partly quoted" : usd(x.total)})`).join(" · ")}</div>` : ""}
${s.notes.length ? `<div style="margin:8px 0 0;font-size:12px;color:#55555c;">${s.notes.map(esc).join("<br>")}</div>` : ""}
<div style="margin:10px 0 0;"><a href="${siteUrl()}/orders/web/${id}/strategy" style="font-weight:700;color:#C8102E;">Open the full Best Strategy sheet</a></div>
</div>`;
}

function orderEmail(no: string, o: AdcOrderInput & { account?: string | null; bucks?: number | null }, lines: Line[], subtotal: number, hasQuote: boolean, branchName: string | null, forCustomer: boolean, extra?: { intake: Intake | null; id: number }) {
  const es = forCustomer && o.lang === "es";
  const L = es
    ? { confirm: "Por confirmar", sale: "OFERTA", pickup: "Recoger en", loc: "una sede de AMBIT", ship: "Enviar a:", truck: "Camión completo, entregar en:", contact: "Un miembro del equipo de AMBIT le contactará con los totales exactos. Permita hasta 4 horas para el contacto en horario de oficina.", disc: "Los estimados de envío vienen de transportistas externos y no están garantizados.", part: "Parte #", item: "Artículo", qty: "Cant.", each: "C/u", total: "Total", sub: "Subtotal", subQ: " (artículos con precio)", toConf: 'AMBIT pone el precio a las líneas marcadas "Por confirmar" antes de enviar el pedido.', notes: "Notas:", tax: "El envío y los impuestos se agregan cuando confirmamos el pedido.", order: "Pedido", foot: "ADC · AMBIT Distribution Centers · una división de AMBIT Polyurethane · orders@ambitpu.com" }
    : { confirm: "To confirm", sale: "SALE", pickup: "Pick up at", loc: "an AMBIT location", ship: "Ship to:", truck: "Full truckload, deliver to:", contact: "An AMBIT team member will contact you with exact totals. Please allow up to 4 hours for contact during business hours.", disc: "Shipping estimates come from third-party carriers and are not guaranteed.", part: "Part #", item: "Item", qty: "Qty", each: "Each", total: "Total", sub: "Subtotal", subQ: " (priced items)", toConf: 'Lines marked "To confirm" are priced by AMBIT before the order ships.', notes: "Notes:", tax: "Shipping and tax are added when we confirm the order.", order: "Order", foot: "ADC · AMBIT Distribution Centers · a division of AMBIT Polyurethane · orders@ambitpu.com" };
  const rows = lines
    .map(
      (l) => `<tr>
<td style="padding:8px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px;">${esc(l.sku)}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:14px;">${esc(l.name)}${l.on_sale ? ` <b style="color:#CF2E20;">${L.sale}</b>` : ""}${l.promo ? `<br><span style="color:#CF2E20;font-size:12px;">${esc(l.promo)}</span>` : ""}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;font-size:14px;">${l.qty}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;font-size:14px;">${l.price === null ? L.confirm : usd(l.price)}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;font-size:14px;font-weight:700;">${l.price === null ? "-" : usd(l.price * l.qty)}</td></tr>`,
    )
    .join("");
  const a = o.address;
  const where =
    o.delivery === "pickup"
      ? `${L.pickup} <b>${esc(branchName ?? o.pickup_branch ?? L.loc)}</b>`
      : `${o.delivery === "truckload" ? L.truck : L.ship}<br><b>${esc(o.name)}</b>${o.company ? `<br>${esc(o.company)}` : ""}<br>${esc(a.street)}${a.street2 ? `<br>${esc(a.street2)}` : ""}<br>${esc(a.city)}, ${esc(a.state.toUpperCase())} ${esc(a.zip)}`;
  const intro = es
    ? `<p style="margin:0 0 14px;font-size:15px;">Gracias, ${esc(o.name.split(" ")[0])}. Recibimos su pedido <b>${no}</b>. Nada se envía hasta que confirmemos el total, el envío y el pago con usted.</p><p style="margin:0 0 14px;font-size:15px;"><b>${L.contact}</b></p>`
    : forCustomer
      ? `<p style="margin:0 0 14px;font-size:15px;">Thanks, ${esc(o.name.split(" ")[0])}. We got your order <b>${no}</b>. Nothing ships until we confirm the total, shipping and payment with you.</p><p style="margin:0 0 14px;font-size:15px;"><b>${L.contact}</b></p>`
      : `<p style="margin:0 0 14px;font-size:15px;"><b>New ADC web order ${no}.</b> ${o.account ? `Placed by an ADC account holder (${esc(o.account)}).` : "Placed as a guest on the ADC store."} No payment was taken: <b>contact the customer within 4 business hours</b> to confirm prices, shipping and payment.${o.bucks ? ` <b>They want to use ${usd(o.bucks)} in AM-BUCKS.</b>` : ""}${o.delivery === "truckload" ? " <b>Full truckload delivery requested.</b>" : ""}${o.lang === "es" ? " <b>The customer ordered on the Spanish store and got their copy in Spanish.</b>" : ""}</p>`;
  const inner = `${!forCustomer && extra ? redAlert(extra.intake) : ""}${intro}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px;">
<tr><td style="vertical-align:top;padding:0 12px 0 0;"><b>${esc(o.name)}</b>${o.company ? `<br>${esc(o.company)}` : ""}<br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a><br>${esc(o.phone)}</td>
<td style="vertical-align:top;">${where}</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="background:#f4f4f2;"><th align="left" style="padding:8px 6px;font-size:12px;">${L.part}</th><th align="left" style="padding:8px 6px;font-size:12px;">${L.item}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.qty}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.each}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.total}</th></tr>
${rows}
<tr><td colspan="4" style="padding:10px 6px;text-align:right;font-weight:700;">${L.sub}${hasQuote ? L.subQ : ""}</td><td style="padding:10px 6px;text-align:right;font-weight:800;font-size:16px;">${usd(subtotal)}</td></tr>
</table>
${hasQuote ? `<p style="margin:12px 0 0;font-size:13px;color:#55555c;">${L.toConf}</p>` : ""}
${extra?.intake?.estimate !== null && extra?.intake?.estimate !== undefined && o.delivery !== "pickup" ? `<p style="margin:12px 0 0;font-size:15px;"><b>${es ? "Envío estimado" : "Estimated shipping"}: ${usd(extra.intake.estimate)}</b>${extra.intake.strategy?.partial ? (es ? " (algunos artículos se cotizan aparte)" : " (some items quoted separately)") : ""}<br><span style="font-size:12px;color:#55555c;">${es ? "Solo es un estimado. Confirmamos el costo final del envío antes de enviar nada." : "Estimate only. We confirm the final shipping cost before anything ships."}</span></p>` : ""}
${o.notes ? `<p style="margin:12px 0 0;font-size:14px;"><b>${L.notes}</b> ${esc(o.notes)}</p>` : ""}
<p style="margin:12px 0 0;font-size:13px;color:#55555c;">${L.tax} ${L.disc}</p>
${!forCustomer && extra ? staffBlocks(o, extra.intake, extra.id) : ""}`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0a0a0b;">
<tr><td style="background:#0A0A0B;padding:18px 24px;border-bottom:4px solid #E33527;"><span style="font-size:24px;font-weight:900;letter-spacing:3px;color:#F5F5F7;">A</span><span style="font-size:24px;font-weight:900;letter-spacing:3px;color:#F5F5F7;">D</span><span style="font-size:24px;font-weight:900;letter-spacing:3px;color:#E33527;">C</span>
<span style="float:right;font-size:12px;color:#B4B4BC;line-height:30px;">${L.order} ${no}</span></td></tr>
<tr><td style="padding:24px;">${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#71717a;">${L.foot}</td></tr>
</table></td></tr></table></body></html>`;
}

/** A guest places an order on the ADC store: saved, then emailed to orders@ (and a copy to the customer). */
export async function placeAdcOrder(o: AdcOrderInput): Promise<AdcOrderResult> {
  // Bots fill every box; people never see this one.
  if (o.website) return { ok: true, order_no: "ADC-0" };
  const clean = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
  const input: AdcOrderInput = {
    name: clean(o.name, 120),
    company: clean(o.company, 160),
    email: clean(o.email, 160),
    phone: clean(o.phone, 40),
    delivery: o.delivery === "pickup" ? "pickup" : o.delivery === "truckload" ? "truckload" : "ship",
    pickup_branch: clean(o.pickup_branch, 40),
    address: { street: clean(o.address?.street, 160), street2: clean(o.address?.street2, 160), city: clean(o.address?.city, 80), state: clean(o.address?.state, 2), zip: clean(o.address?.zip, 10) },
    notes: clean(o.notes, 2000),
    lang: o.lang === "es" ? "es" : o.lang === "zh" ? "zh" : "en",
    promo_opt_in: Boolean(o.promo_opt_in),
    use_bucks: Boolean(o.use_bucks),
    items: (Array.isArray(o.items) ? o.items : []).slice(0, 120).map((i) => ({
      product_id: i.product_id ? clean(i.product_id, 40) : null,
      sku: clean(i.sku, 40),
      name: clean(i.name, 160),
      qty: Math.max(0, Math.min(9999, Math.round(Number(i.qty) || 0))),
    })),
    customer: {
      kind: o.customer?.kind === "account" ? "account" : "new",
      check: clean(o.customer?.check, 60),
      bill_same: o.delivery === "pickup" ? false : o.customer?.bill_same !== false,
      bill: { street: clean(o.customer?.bill?.street, 160), city: clean(o.customer?.bill?.city, 80), state: clean(o.customer?.bill?.state, 2).toUpperCase(), zip: clean(o.customer?.bill?.zip, 10) },
      tax_exempt: false,
      hours: clean(o.customer?.hours, 120),
      site: o.customer?.site === "home" ? "home" : "business",
      unload: o.customer?.unload === "forklift" ? "forklift" : o.customer?.unload === "liftgate" ? "liftgate" : "dock",
    },
  };
  // Who's ordering: a business name always; a current customer gives the phone or account # we have on file;
  // a new customer gives a billing address (the shipping address counts when they say it's the same).
  const cu = input.customer!;
  if (input.company.length < 2) return { ok: false, error: "Please add your business name." };
  // Receiving hours ride on the order notes, so they show everywhere the order does.
  if (input.delivery !== "pickup" && cu.hours) input.notes = `${input.notes ? `${input.notes}\n` : ""}Receiving hours: ${cu.hours}`.slice(0, 2000);
  if (cu.kind === "new" && !cu.bill_same && (cu.bill.street.length < 3 || cu.bill.city.length < 2 || cu.bill.state.length < 2 || cu.bill.zip.replace(/\D/g, "").length < 5)) {
    return { ok: false, error: "Please add the billing address." };
  }
  const supabase = await createClient();
  // Staff see on the web orders page that this customer used the Spanish store.
  const { data, error } = await supabase.rpc("adc_place_order", { p: input.lang !== "en" ? { ...input, notes: `${input.notes ? `${input.notes}\n` : ""}[Ordered on the ${input.lang === "es" ? "Spanish" : "Chinese"} store]`.slice(0, 2000) } : input });
  if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, "") || "That didn't go through. Please try again." };
  const res = data as { id: number; order_no: string; subtotal: number; has_quote: boolean; items: Line[]; bucks: number | null };

  // The lines exactly as the database saved them (its prices, sets and sale flags), for the emails.
  let lines: Line[] = (res.items ?? []).map((l) => ({ ...l, price: l.price === null ? null : Number(l.price), qty: Number(l.qty) }));
  let branchName: string | null = null;
  if (input.delivery === "pickup" && input.pickup_branch) {
    const { data: b } = await supabase.from("branches").select("name").eq("id", input.pickup_branch).maybeSingle();
    branchName = (b as { name: string } | null)?.name ?? null;
  }
  const { data: auth } = await supabase.auth.getUser();
  const mail = { ...input, account: auth.user?.email ?? null, bucks: res.bucks === null ? null : Number(res.bucks) };

  // Who the customer is, the Best Strategy and the alerts (never stops the order: the email still goes out).
  let intake: Intake | null = null;
  try {
    intake = await intakeAdcOrder({
      id: res.id,
      order_no: res.order_no,
      subtotal: Number(res.subtotal),
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      delivery: input.delivery,
      pickup_branch: input.pickup_branch,
      address: input.address,
      kind: cu.kind,
      check: cu.check,
      bill: cu.bill_same ? null : cu.bill,
      tax_exempt: cu.tax_exempt,
      site: { site: cu.site, unload: cu.unload },
      lines: lines.map((l) => ({ product_id: l.product_id ?? null, sku: l.sku, name: l.name, qty: l.qty })),
    });
  } catch (e) {
    console.error("adc intake failed", e);
  }
  const red = intake ? intake.red.length > 0 : true;

  // Prices by who it is: an AMBIT customer gets the full sale price (the store only shows 5% off), and the spray
  // foam sale is for AMBIT customers only.
  try {
    const priced = await priceForCustomer({ id: res.id, lines, ambitCustomer: intake?.match === "verified" });
    if (priced) {
      lines = priced.lines as Line[];
      res.subtotal = priced.subtotal;
      res.has_quote = priced.has_quote;
    }
  } catch (e) {
    console.error("adc pricing failed", e);
  }
  const h = await headers();
  const from = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const sent = await sendEmail({
    to: [ORDERS_EMAIL],
    fromName: "ADC Web Store",
    replyTo: input.email,
    subject: `${red ? "ACTION NEEDED · " : ""}ADC web order ${res.order_no}: ${input.company || input.name}${intake?.match === "added" || intake?.match === "new" ? " (NEW CUSTOMER)" : intake?.match === "unverified" ? " (NOT VERIFIED)" : ""}${res.has_quote ? " (some prices to confirm)" : ""}${input.delivery === "truckload" ? " · FULL TRUCK" : ""}`,
    html: orderEmail(res.order_no, mail, lines, Number(res.subtotal), res.has_quote, branchName, false, { intake, id: res.id }),
    text: `New ADC web order ${res.order_no} from ${input.name} (${input.email}, ${input.phone}). ${lines.map((l) => `${l.qty} x ${l.sku} ${l.name}`).join("; ")}. Subtotal ${usd(Number(res.subtotal))}.${from ? ` IP ${from}.` : ""}`,
  });
  if (canEmailCustomers()) {
    await sendEmail({
      to: [input.email],
      fromName: "ADC · AMBIT Distribution Centers",
      subject: input.lang === "es" ? `Recibimos su pedido ADC ${res.order_no}` : `We got your ADC order ${res.order_no}`,
      html: orderEmail(res.order_no, mail, lines, Number(res.subtotal), res.has_quote, branchName, true, { intake, id: res.id }),
      text: input.lang === "es"
        ? `Gracias. Recibimos su pedido ${res.order_no}. Un miembro del equipo de AMBIT le contactará con los totales exactos. Permita hasta 4 horas para el contacto en horario de oficina.`
        : `Thanks. We got your order ${res.order_no}. An AMBIT team member will contact you with exact totals. Please allow up to 4 hours for contact during business hours.`,
    });
  }
  await supabase.rpc("adc_mark_emailed", { p_id: res.id, p_status: sent.status });
  return { ok: true, order_no: res.order_no };
}

export type ShipQuote = { ok: true; estimate: number | null; partial: boolean; days: string | null } | { ok: false };

/** The checkout's shipping estimate: closest stock, weight and distance (high side, rounded up). No order is saved. */
export async function adcShipEstimate(q: {
  items: { product_id?: string | null; sku?: string; qty: number }[];
  delivery: "ship" | "pickup" | "truckload";
  zip: string;
  site: "business" | "home";
  unload: "dock" | "forklift" | "liftgate";
}): Promise<ShipQuote> {
  try {
    const zip = String(q.zip ?? "").replace(/\D/g, "").slice(0, 5);
    if (q.delivery === "pickup") return { ok: true, estimate: 0, partial: false, days: null };
    if (zip.length < 5) return { ok: false };
    const lines = (Array.isArray(q.items) ? q.items : []).slice(0, 120).map((i) => ({
      product_id: i.product_id ? String(i.product_id).slice(0, 40) : null,
      sku: String(i.sku ?? "").slice(0, 40),
      name: "",
      qty: Math.max(0, Math.min(9999, Math.round(Number(i.qty) || 0))),
    }));
    const s = await estimateFor({
      lines,
      delivery: q.delivery === "truckload" ? "truckload" : "ship",
      zip,
      site: { site: q.site === "home" ? "home" : "business", unload: q.unload === "liftgate" ? "liftgate" : q.unload === "forklift" ? "forklift" : "dock" },
    });
    if (!s || s.estimate === null) return { ok: false };
    const best = s.options.find((x) => x.key === s.best);
    return { ok: true, estimate: s.estimate, partial: s.partial, days: best?.days ?? null };
  } catch {
    return { ok: false };
  }
}
