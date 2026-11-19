"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { canEmailCustomers, sendEmail } from "@/lib/email";
import { ORDERS_EMAIL } from "@/lib/env";

export type AdcOrderInput = {
  name: string;
  company: string;
  email: string;
  phone: string;
  delivery: "ship" | "pickup";
  pickup_branch: string;
  address: { street: string; street2: string; city: string; state: string; zip: string };
  notes: string;
  website?: string;
  /** The store's language when they ordered (es: the customer's email is in Spanish). */
  lang?: "en" | "es";
  items: { product_id?: string | null; sku?: string; name?: string; qty: number }[];
};
export type AdcOrderResult = { ok: true; order_no: string } | { ok: false; error: string };

type Line = { sku: string; name: string; unit: string | null; qty: number; price: number | null; list_price?: number | null; on_sale?: boolean; promo?: string | null };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

function orderEmail(no: string, o: AdcOrderInput, lines: Line[], subtotal: number, hasQuote: boolean, branchName: string | null, forCustomer: boolean) {
  const es = forCustomer && o.lang === "es";
  const L = es
    ? { confirm: "Por confirmar", sale: "OFERTA", pickup: "Recoger en", loc: "una sede de AMBIT", ship: "Enviar a:", part: "Parte #", item: "Artículo", qty: "Cant.", each: "C/u", total: "Total", sub: "Subtotal", subQ: " (artículos con precio)", toConf: 'AMBIT pone el precio a las líneas marcadas "Por confirmar" antes de enviar el pedido.', notes: "Notas:", tax: "El envío y los impuestos se agregan cuando confirmamos el pedido.", order: "Pedido", foot: "ADC · AMBIT Distribution Centers · una división de AMBIT Polyurethane · orders@ambitpu.com" }
    : { confirm: "To confirm", sale: "SALE", pickup: "Pick up at", loc: "an AMBIT location", ship: "Ship to:", part: "Part #", item: "Item", qty: "Qty", each: "Each", total: "Total", sub: "Subtotal", subQ: " (priced items)", toConf: 'Lines marked "To confirm" are priced by AMBIT before the order ships.', notes: "Notes:", tax: "Shipping and tax are added when we confirm the order.", order: "Order", foot: "ADC · AMBIT Distribution Centers · a division of AMBIT Polyurethane · orders@ambitpu.com" };
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
      : `${L.ship}<br><b>${esc(o.name)}</b>${o.company ? `<br>${esc(o.company)}` : ""}<br>${esc(a.street)}${a.street2 ? `<br>${esc(a.street2)}` : ""}<br>${esc(a.city)}, ${esc(a.state.toUpperCase())} ${esc(a.zip)}`;
  const intro = es
    ? `<p style="margin:0 0 14px;font-size:15px;">Gracias, ${esc(o.name.split(" ")[0])}. Recibimos su pedido <b>${no}</b>. Alguien de AMBIT le llamará o le escribirá para confirmar el total, el envío y el pago antes de enviar nada.</p>`
    : forCustomer
      ? `<p style="margin:0 0 14px;font-size:15px;">Thanks, ${esc(o.name.split(" ")[0])}. We got your order <b>${no}</b>. Someone from AMBIT will call or email you to confirm the total, shipping and payment before anything ships.</p>`
      : `<p style="margin:0 0 14px;font-size:15px;"><b>New ADC web order ${no}.</b> Placed as a guest on the ADC store. No payment was taken: call or email the customer to confirm prices, shipping and payment.${o.lang === "es" ? " <b>The customer ordered on the Spanish store and got their copy in Spanish.</b>" : ""}</p>`;
  const inner = `${intro}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px;">
<tr><td style="vertical-align:top;padding:0 12px 0 0;"><b>${esc(o.name)}</b>${o.company ? `<br>${esc(o.company)}` : ""}<br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a><br>${esc(o.phone)}</td>
<td style="vertical-align:top;">${where}</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="background:#f4f4f2;"><th align="left" style="padding:8px 6px;font-size:12px;">${L.part}</th><th align="left" style="padding:8px 6px;font-size:12px;">${L.item}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.qty}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.each}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.total}</th></tr>
${rows}
<tr><td colspan="4" style="padding:10px 6px;text-align:right;font-weight:700;">${L.sub}${hasQuote ? L.subQ : ""}</td><td style="padding:10px 6px;text-align:right;font-weight:800;font-size:16px;">${usd(subtotal)}</td></tr>
</table>
${hasQuote ? `<p style="margin:12px 0 0;font-size:13px;color:#55555c;">${L.toConf}</p>` : ""}
${o.notes ? `<p style="margin:12px 0 0;font-size:14px;"><b>${L.notes}</b> ${esc(o.notes)}</p>` : ""}
<p style="margin:12px 0 0;font-size:13px;color:#55555c;">${L.tax}</p>`;
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
    delivery: o.delivery === "pickup" ? "pickup" : "ship",
    pickup_branch: clean(o.pickup_branch, 40),
    address: { street: clean(o.address?.street, 160), street2: clean(o.address?.street2, 160), city: clean(o.address?.city, 80), state: clean(o.address?.state, 2), zip: clean(o.address?.zip, 10) },
    notes: clean(o.notes, 2000),
    lang: o.lang === "es" ? "es" : "en",
    items: (Array.isArray(o.items) ? o.items : []).slice(0, 120).map((i) => ({
      product_id: i.product_id ? clean(i.product_id, 40) : null,
      sku: clean(i.sku, 40),
      name: clean(i.name, 160),
      qty: Math.max(0, Math.min(9999, Math.round(Number(i.qty) || 0))),
    })),
  };
  const supabase = await createClient();
  // Staff see on the web orders page that this customer used the Spanish store.
  const { data, error } = await supabase.rpc("adc_place_order", { p: input.lang === "es" ? { ...input, notes: `${input.notes ? `${input.notes}\n` : ""}[Ordered on the Spanish store]`.slice(0, 2000) } : input });
  if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, "") || "That didn't go through. Please try again." };
  const res = data as { id: number; order_no: string; subtotal: number; has_quote: boolean };

  // The lines with the database's prices, for the emails.
  const { data: cat } = await supabase.rpc("adc_catalog");
  const byId = new Map(((cat ?? []) as { id: string; sku: string; name: string; unit: string | null; list_price: number | null; quote: boolean; sale_price: number | null }[]).map((c) => [c.id, c]));
  const { data: s2 } = await supabase.rpc("adc_sale");
  const foam = ((s2 ?? []) as { foam_off_per_lb: number | null }[])[0]?.foam_off_per_lb ?? null;
  const lines: Line[] = input.items
    .filter((i) => i.qty > 0)
    .map((i) => {
      const c = i.product_id ? byId.get(i.product_id) : null;
      if (c) {
        const price = c.quote ? null : Number(c.sale_price ?? c.list_price);
        return { sku: c.sku, name: c.name, unit: c.unit, qty: i.qty, price: Number.isFinite(price as number) ? price : null, on_sale: c.sale_price !== null && !c.quote, promo: c.quote && foam ? (input.lang === "es" ? `$${Number(foam).toFixed(2)} menos por libra sobre su precio (oferta)` : `$${Number(foam).toFixed(2)} per lb off your price (sale)`) : null };
      }
      return { sku: i.sku ?? "", name: i.name || "Part", unit: "each", qty: i.qty, price: null };
    })
    .filter((l) => l.sku);
  let branchName: string | null = null;
  if (input.delivery === "pickup" && input.pickup_branch) {
    const { data: b } = await supabase.from("branches").select("name").eq("id", input.pickup_branch).maybeSingle();
    branchName = (b as { name: string } | null)?.name ?? null;
  }
  const h = await headers();
  const from = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const sent = await sendEmail({
    to: [ORDERS_EMAIL],
    fromName: "ADC Web Store",
    replyTo: input.email,
    subject: `ADC web order ${res.order_no}: ${input.company || input.name}${res.has_quote ? " (some prices to confirm)" : ""}`,
    html: orderEmail(res.order_no, input, lines, Number(res.subtotal), res.has_quote, branchName, false),
    text: `New ADC web order ${res.order_no} from ${input.name} (${input.email}, ${input.phone}). ${lines.map((l) => `${l.qty} x ${l.sku} ${l.name}`).join("; ")}. Subtotal ${usd(Number(res.subtotal))}.${from ? ` IP ${from}.` : ""}`,
  });
  if (canEmailCustomers()) {
    await sendEmail({
      to: [input.email],
      fromName: "ADC · AMBIT Distribution Centers",
      subject: input.lang === "es" ? `Recibimos su pedido ADC ${res.order_no}` : `We got your ADC order ${res.order_no}`,
      html: orderEmail(res.order_no, input, lines, Number(res.subtotal), res.has_quote, branchName, true),
      text: input.lang === "es"
        ? `Gracias. Recibimos su pedido ${res.order_no}. Alguien de AMBIT se comunicará con usted para confirmar el total, el envío y el pago antes de enviar nada.`
        : `Thanks. We got your order ${res.order_no}. Someone from AMBIT will contact you to confirm the total, shipping and payment before anything ships.`,
    });
  }
  await supabase.rpc("adc_mark_emailed", { p_id: res.id, p_status: sent.status });
  return { ok: true, order_no: res.order_no };
}
