import "server-only";
import type { PartnerRow } from "@/lib/partner-store";

// Emails from a partner's store, in the partner's colors with their logo (the app sends them; replies go to the partner).

export type PEmailLine = { sku: string; name: string; unit: string | null; qty: number; price: number | null; per_lb?: number | null };
export type POrderMail = {
  name: string;
  company: string;
  email: string;
  phone: string;
  delivery: "ship" | "pickup";
  address: { street: string; city: string; state: string; zip: string };
  po: string;
  notes: string;
  lang: "en" | "es";
  account: string | null;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const hex = (c: string | null | undefined, d: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : d);

/** The frame every partner email uses: their color across the top with their logo, and their contact info at the bottom. */
export function partnerWrap(p: PartnerRow, origin: string, right: string, inner: string) {
  const color = hex(p.color, "#2d694b");
  const logo = p.logo_url ? (p.logo_url.startsWith("http") ? p.logo_url : `${origin}${p.logo_url}`) : null;
  const head = logo
    ? `<img src="${esc(logo)}" alt="${esc(p.name)}" height="34" style="display:block;height:34px;width:auto;border:0;">`
    : `<span style="font-size:20px;font-weight:900;color:#ffffff;">${esc(p.name)}</span>`;
  const contact = [p.name, p.phone, p.email].filter(Boolean).map((x) => esc(String(x))).join(" · ");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0a0a0b;">
<tr><td style="background:${color};padding:18px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;">${head}</td><td align="right" style="vertical-align:middle;font-size:12px;color:#ffffff;opacity:.85;">${esc(right)}</td></tr></table></td></tr>
<tr><td style="padding:24px;">${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#71717a;">${contact}</td></tr>
</table></td></tr></table></body></html>`;
}

export function partnerOrderEmail(p: PartnerRow, origin: string, no: string, o: POrderMail, lines: PEmailLine[], subtotal: number, hasQuote: boolean, forCustomer: boolean, shipping: number | null = null) {
  const es = forCustomer && o.lang === "es";
  const color = hex(p.color, "#2d694b");
  const L = es
    ? { confirm: "Por confirmar", lb: "por libra", pickup: "Lo recoge en", ship: "Enviar a:", part: "Parte #", item: "Artículo", qty: "Cant.", each: "C/u", total: "Total", sub: "Subtotal", subQ: " (artículos con precio)", toConf: 'Las líneas "Por confirmar" reciben su precio antes de enviar el pedido. La espuma se cobra por libra según el peso.', notes: "Notas:", po: "Orden de compra:", tax: "El envío y los impuestos se agregan en la factura.", order: "Pedido" }
    : { confirm: "To confirm", lb: "per lb", pickup: "Picking up from", ship: "Ship to:", part: "Part #", item: "Item", qty: "Qty", each: "Each", total: "Total", sub: "Subtotal", subQ: " (priced items)", toConf: 'Lines marked "To confirm" are priced before the order ships. Spray foam is billed per lb by weight.', notes: "Notes:", po: "PO:", tax: "Shipping and tax are added on the invoice.", order: "Order" };
  const rows = lines
    .map((l) => {
      const each = l.price !== null ? usd(l.price) : l.per_lb ? `${usd(l.per_lb)} ${L.lb}` : L.confirm;
      return `<tr>
<td style="padding:8px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px;">${esc(l.sku)}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:14px;">${esc(l.name)}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;font-size:14px;">${l.qty}${l.unit && l.unit !== "each" ? ` ${esc(l.unit)}` : ""}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;font-size:14px;">${each}</td>
<td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;font-size:14px;font-weight:700;">${l.price === null ? "-" : usd(l.price * l.qty)}</td></tr>`;
    })
    .join("");
  const a = o.address;
  const where = o.delivery === "pickup" ? `${L.pickup} <b>${esc(p.name)}</b>` : `${L.ship}<br><b>${esc(o.name)}</b>${o.company ? `<br>${esc(o.company)}` : ""}<br>${esc(a.street)}<br>${esc(a.city)}${a.city ? ", " : ""}${esc(a.state.toUpperCase())} ${esc(a.zip)}`;
  const first = esc(o.name.split(" ")[0] ?? "");
  const intro = forCustomer
    ? es
      ? `<p style="margin:0 0 14px;font-size:15px;">Gracias, ${first}. Recibimos su pedido <b>${no}</b>. Le llamaremos o le escribiremos para confirmar el total y el envío. Si tiene preguntas, responda a este correo o llámenos al ${esc(p.phone ?? "")}.</p>`
      : `<p style="margin:0 0 14px;font-size:15px;">Thanks, ${first}. We got your order <b>${no}</b>. We'll call or email you to confirm the total and shipping. Questions? Reply to this email or call us at ${esc(p.phone ?? "")}.</p>`
    : `<p style="margin:0 0 14px;font-size:15px;"><b>New store order ${no}.</b> ${o.account ? `Placed by your customer <b>${esc(o.account)}</b> while signed in.` : "Placed as a guest."} No payment was taken: confirm the total and shipping, then send the invoice.${o.lang === "es" ? " <b>They ordered on the Spanish store and got their copy in Spanish.</b>" : ""}</p>`;
  const inner = `${intro}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px;">
<tr><td style="vertical-align:top;padding:0 12px 0 0;"><b>${esc(o.name)}</b>${o.company ? `<br>${esc(o.company)}` : ""}<br><a href="mailto:${esc(o.email)}" style="color:${color};">${esc(o.email)}</a>${o.phone ? `<br>${esc(o.phone)}` : ""}</td>
<td style="vertical-align:top;">${where}</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="background:#f4f4f2;"><th align="left" style="padding:8px 6px;font-size:12px;">${L.part}</th><th align="left" style="padding:8px 6px;font-size:12px;">${L.item}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.qty}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.each}</th><th align="right" style="padding:8px 6px;font-size:12px;">${L.total}</th></tr>
${rows}
<tr><td colspan="4" style="padding:10px 6px;text-align:right;font-weight:700;">${L.sub}${hasQuote ? L.subQ : ""}</td><td style="padding:10px 6px;text-align:right;font-weight:800;font-size:16px;">${usd(subtotal)}</td></tr>${shipping !== null && o.delivery === "ship" ? `<tr><td colspan="4" style="padding:4px 6px;text-align:right;font-weight:700;">${o.lang === "es" ? "Envío" : "Shipping"}</td><td style="padding:4px 6px;text-align:right;font-weight:700;">${shipping === 0 ? (o.lang === "es" ? "Gratis" : "Free") : usd(shipping)}</td></tr>` : ""}
</table>
${hasQuote ? `<p style="margin:12px 0 0;font-size:13px;color:#55555c;">${L.toConf}</p>` : ""}
${o.po ? `<p style="margin:12px 0 0;font-size:14px;"><b>${L.po}</b> ${esc(o.po)}</p>` : ""}
${o.notes ? `<p style="margin:12px 0 0;font-size:14px;"><b>${L.notes}</b> ${esc(o.notes)}</p>` : ""}
<p style="margin:12px 0 0;font-size:13px;color:#55555c;">${L.tax}</p>`;
  return partnerWrap(p, origin, `${L.order} ${no}`, inner);
}

/** The invite: the store owner's (from AMBIT) or a customer's (from the store owner). */
export function partnerInviteEmail(p: PartnerRow, origin: string, link: string, role: "owner" | "customer", name: string | null, company: string | null) {
  const color = hex(p.color, "#2d694b");
  const first = name ? esc(name.split(/\s+/)[0]) : null;
  const inner =
    role === "owner"
      ? `<div style="font-size:22px;font-weight:800;margin-bottom:12px;">${first ? `${first}, your` : "Your"} ${esc(p.name)} store is ready.</div>
<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">AMBIT built your online store: your own price sheet, your customers' logins and prices, and every order in one place. Tap the button to make your password and open your store desk.</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Your prices, customers and orders are private to you. AMBIT staff can't see them. Only Jeremiah Bryant can look (he can't change anything), so he can help you get set up.</p>`
      : `<div style="font-size:22px;font-weight:800;margin-bottom:12px;">${first ? `${first}, you` : "You"} have an account with ${esc(p.name)}.</div>
<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">${company ? `We set up <b>${esc(company)}</b> on our online store. ` : ""}Make your password to see your prices, order online any time, and track every order.</p>`;
  const button = `<p style="margin:20px 0 6px;"><a href="${esc(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 20px;border-radius:8px;">${role === "owner" ? "SET UP MY STORE LOGIN" : "MAKE MY PASSWORD"}</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#71717a;">The link works for 30 days. If the button doesn't work, copy this into your browser:<br><span style="word-break:break-all;">${esc(link)}</span></p>`;
  return partnerWrap(p, origin, role === "owner" ? "Store owner invite" : "Your account", inner + button);
}

/** "Your order shipped" to the customer, in their language. */
export function partnerShippedEmail(p: PartnerRow, origin: string, no: string, name: string, tracking: string | null, lang: "en" | "es") {
  const first = esc(name.split(" ")[0] ?? "");
  const inner =
    lang === "es"
      ? `<div style="font-size:22px;font-weight:800;margin-bottom:12px;">Su pedido ${no} va en camino.</div><p style="margin:0;font-size:15px;line-height:1.5;">Hola ${first}, enviamos su pedido.${tracking ? ` Número de rastreo: <b>${esc(tracking)}</b>.` : ""} ¿Preguntas? Responda a este correo o llámenos al ${esc(p.phone ?? "")}.</p>`
      : `<div style="font-size:22px;font-weight:800;margin-bottom:12px;">Your order ${no} is on the way.</div><p style="margin:0;font-size:15px;line-height:1.5;">Hi ${first}, your order shipped.${tracking ? ` Tracking number: <b>${esc(tracking)}</b>.` : ""} Questions? Reply to this email or call us at ${esc(p.phone ?? "")}.</p>`;
  return partnerWrap(p, origin, `${lang === "es" ? "Pedido" : "Order"} ${no}`, inner);
}

/** "Make your password" / "Reset your password" for a store login (sent by the app, so it reaches any inbox). */
export function partnerPasswordEmail(p: PartnerRow, origin: string, link: string, kind: "reset" | "handover", name: string | null, lang: "en" | "es" = "en") {
  const color = hex(p.color, "#2d694b");
  const first = name ? esc(name.split(/\s+/)[0]) : null;
  const es = lang === "es";
  const head =
    kind === "handover"
      ? `${first ? `${first}, your` : "Your"} ${esc(p.name)} store is ready for you.`
      : es
        ? `${first ? `${first}, r` : "R"}establezca su contraseña de ${esc(p.name)}.`
        : `${first ? `${first}, r` : "R"}eset your ${esc(p.name)} password.`;
  const body =
    kind === "handover"
      ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Tap the button to make your own password. Only you will know it. Then you'll land on your store desk: your price sheet, your customers and their logins, and every order.</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Your prices, customers and orders are private to you. AMBIT staff can't see them. Only Jeremiah Bryant can look (he can't change anything), so he can help you get set up.</p>`
      : es
        ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Toque el botón para elegir una nueva contraseña. Si usted no lo pidió, ignore este correo.</p>`
        : `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Tap the button to choose a new password. If you didn't ask for this, you can ignore this email.</p>`;
  const label = kind === "handover" ? "MAKE MY PASSWORD" : es ? "NUEVA CONTRASEÑA" : "CHOOSE A NEW PASSWORD";
  const button = `<p style="margin:20px 0 6px;"><a href="${esc(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 20px;border-radius:8px;">${label}</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#71717a;">${es ? "El enlace funciona por 1 hora; si se vence, use Olvidé mi contraseña en la página para entrar." : "The link works for 1 hour. If it runs out, tap Forgot password on your store's sign-in page."} ${es ? "Si el botón no funciona, copie esto en su navegador:" : "If the button doesn't work, copy this into your browser:"}<br><span style="word-break:break-all;">${esc(link)}</span></p>`;
  return partnerWrap(p, origin, kind === "handover" ? "Your store login" : es ? "Contraseña" : "Password", `<div style="font-size:22px;font-weight:800;margin-bottom:12px;">${head}</div>${body}${button}`);
}
