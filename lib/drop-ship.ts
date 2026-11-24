import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email";
import { ORDERS_EMAIL, siteUrl } from "@/lib/env";
import { orderNo as partnerOrderNo, type PartnerRow } from "@/lib/partner-store";
import { partnerWrap } from "@/lib/partner-email";

// Gun parts are drop shipped (0104): when the order desk releases an order at the credit check, the lines whose
// product has a drop_ship_partner go to that partner as an order "from AMBIT" on their own order desk. They ship to
// AMBIT's customer and bill AMBIT for the parts (their price to AMBIT, products.vendor_cost) and the shipping.
// AMBIT's staff can't read a partner's side, so this runs on the server with the service key.

export type DropLine = { item_id: number; product_id: string; sku: string; name: string; unit: string; qty: number; cost: number | null; partner: string };
export type DropSent = {
  partner: string;
  partnerName: string;
  no: string;
  status: "new" | "shipped" | "done" | "cancelled";
  tracking: string | null;
  subtotal: number;
  hasQuote: boolean;
  shipCost: number | null;
  at: string;
};

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The order's drop-ship lines (any partner). */
export async function dropShipLines(orderId: string): Promise<DropLine[]> {
  if (!serviceReady()) return [];
  const db = serviceClient();
  const { data } = await db
    .from("order_items")
    .select("id, product_id, sku, name, unit, qty, product:products!order_items_product_id_fkey(drop_ship_partner, vendor_cost)")
    .eq("order_id", orderId)
    .order("id");
  type Row = { id: number; product_id: string | null; sku: string; name: string; unit: string | null; qty: number; product: { drop_ship_partner: string | null; vendor_cost: number | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.product_id && r.product?.drop_ship_partner && Number(r.qty) > 0);
  // The partner's price to AMBIT lives in vendor_costs (admins only, 0114); before that update it was on the product.
  const cost = new Map<string, number>();
  if (rows.length) {
    const { data: vc, error } = await db.from("vendor_costs").select("product_id, cost").in("product_id", rows.map((r) => r.product_id!));
    if (!error) for (const v of (vc ?? []) as { product_id: string; cost: number }[]) cost.set(v.product_id, Number(v.cost));
  }
  return rows.map((r) => ({
    item_id: r.id, product_id: r.product_id!, sku: r.sku, name: r.name, unit: r.unit ?? "each", qty: Number(r.qty),
    cost: cost.get(r.product_id!) ?? (r.product!.vendor_cost === null ? null : Number(r.product!.vendor_cost)), partner: r.product!.drop_ship_partner!,
  }));
}

/** What's been sent to partners for this order so far. */
export async function dropShipsSent(orderId: string): Promise<DropSent[]> {
  if (!serviceReady()) return [];
  const db = serviceClient();
  const { data, error } = await db
    .from("partner_orders")
    .select("id, partner_id, status, tracking, subtotal, has_quote, ship_cost, created_at, partner:partners(name, short)")
    .eq("ambit_order_id", orderId)
    .order("created_at");
  if (error) return [];
  type Row = { id: number; partner_id: string; status: DropSent["status"]; tracking: string | null; subtotal: number; has_quote: boolean; ship_cost: number | null; created_at: string; partner: { name: string; short: string } | null };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    partner: r.partner_id, partnerName: r.partner?.name ?? r.partner_id, no: partnerOrderNo(r.partner?.short ?? "", r.id), status: r.status, tracking: r.tracking,
    subtotal: Number(r.subtotal), hasQuote: r.has_quote, shipCost: r.ship_cost === null ? null : Number(r.ship_cost), at: r.created_at,
  }));
}

/**
 * Sends the order's drop-ship lines to their partner(s) once (a partner that already has this order is skipped).
 * Returns the partner order numbers made. Never throws: the release at the credit check must go through regardless.
 */
export async function sendDropShips(orderId: string): Promise<{ made: string[]; error?: string }> {
  if (!serviceReady()) return { made: [], error: "The server key isn't set, so drop-ship orders can't be sent." };
  try {
    const lines = await dropShipLines(orderId);
    if (!lines.length) return { made: [] };
    const db = serviceClient();
    const { data: o } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!o) return { made: [], error: "Order not found." };
    const order = o as {
      id: string; order_no: number; company_name: string; ship_address: string | null; delivery_method: string; branch_id: string | null; ambit_po?: string | null;
      notes: string | null; company_id: string | null;
    };
    let shipTo = "";
    if (order.delivery_method === "pickup" || !order.ship_address) {
      const { data: b } = order.branch_id ? await db.from("branches").select("name, address, zip, phone").eq("id", order.branch_id).maybeSingle() : { data: null };
      const br = b as { name: string; address: string | null; zip: string | null; phone: string | null } | null;
      const addr = br?.address && br.zip && !br.address.includes(br.zip) ? `${br.address} ${br.zip}` : br?.address;
      shipTo = [`AMBIT Polyurethane, ${br?.name ?? "AMBIT location"} (the customer picks up here)`, addr, br?.phone ? `Phone ${br.phone}` : ""].filter(Boolean).join("\n");
    } else {
      // Who receives it: the web order's contact ("ADC web order ADC-1001 from Name (phone, email)"), else the account's.
      const m = /from (.+?) \(([^,)]+)/.exec(order.notes ?? "");
      let contact = m ? `${m[1]}, ${m[2]}` : "";
      if (!contact && order.company_id) {
        const { data: c } = await db.from("companies").select("*").eq("id", order.company_id).maybeSingle();
        const co = c as { contact_name?: string | null; phone?: string | null } | null;
        contact = [co?.contact_name, co?.phone].filter(Boolean).join(", ");
      }
      shipTo = [order.company_name, contact ? `Attn: ${contact}` : "", order.ship_address].filter(Boolean).join("\n");
    }
    const adc = /ADC-\d+/.exec(order.notes ?? "")?.[0] ?? null;
    const ref = [`ORD-${order.order_no}`, order.ambit_po ? `Sales Order # ${order.ambit_po}` : "", adc].filter(Boolean).join(" · ");

    const made: string[] = [];
    for (const partnerId of [...new Set(lines.map((l) => l.partner))]) {
      const mine = lines.filter((l) => l.partner === partnerId);
      const { data: had } = await db.from("partner_orders").select("id").eq("partner_id", partnerId).eq("ambit_order_id", orderId).maybeSingle();
      if (had) continue;
      const { data: p } = await db.from("partners").select("*").eq("id", partnerId).maybeSingle();
      const partner = p as PartnerRow | null;
      if (!partner) continue;
      const { data: pi } = await db.from("partner_items").select("id, sku").eq("partner_id", partnerId).in("sku", mine.map((l) => l.sku));
      const itemId = new Map(((pi ?? []) as { id: string; sku: string }[]).map((x) => [x.sku.toUpperCase(), x.id]));
      const items = mine.map((l) => ({ item_id: itemId.get(l.sku.toUpperCase()) ?? null, sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, price: l.cost }));
      const subtotal = Math.round(items.reduce((s, l) => s + (l.price ?? 0) * l.qty, 0) * 100) / 100;
      const hasQuote = items.some((l) => l.price === null);
      const { data: ins, error } = await db
        .from("partner_orders")
        .insert({
          partner_id: partnerId, source: "ambit", ambit_order_id: orderId, ambit_ref: ref, name: "AMBIT Polyurethane", company: "AMBIT Polyurethane LLC",
          email: ORDERS_EMAIL, phone: "817-677-1200", delivery: "ship", address: null, ship_to: shipTo, po: order.ambit_po ?? `ORD-${order.order_no}`,
          notes: `Drop ship for AMBIT: ship to the address below, then bill AMBIT for the parts and the shipping. AMBIT ${ref}.`,
          items, subtotal, has_quote: hasQuote, lang: "en",
        })
        .select("id")
        .single<{ id: number }>();
      if (error || !ins) {
        console.error("drop ship: insert failed", error?.message);
        continue;
      }
      const no = partnerOrderNo(partner.short, ins.id);
      made.push(no);
      if (partner.email) {
        const origin = siteUrl();
        const rows = items
          .map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${esc(l.sku)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(l.name)}</td><td align="right" style="padding:6px 8px;border-bottom:1px solid #eee;">${l.qty}</td><td align="right" style="padding:6px 8px;border-bottom:1px solid #eee;">${l.price === null ? "to confirm" : usd(l.price)}</td></tr>`)
          .join("");
        const inner = `<div style="font-size:20px;font-weight:800;margin-bottom:6px;">Drop-ship order ${no} from AMBIT</div>
<p style="margin:0 0 14px;font-size:14px;line-height:1.5;">Ship these straight to AMBIT's customer, then bill AMBIT for the parts and the shipping. Mark it shipped on your order desk with the tracking number and the shipping you're charging.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;"><tr style="background:#f4f4f2;"><th align="left" style="padding:6px 8px;">Part #</th><th align="left" style="padding:6px 8px;">Item</th><th align="right" style="padding:6px 8px;">Qty</th><th align="right" style="padding:6px 8px;">Your price</th></tr>${rows}</table>
<p style="margin:12px 0 0;font-size:14px;"><b>Parts:</b> ${usd(subtotal)}${hasQuote ? " + items to price" : ""}</p>
<p style="margin:14px 0 0;font-size:14px;line-height:1.5;"><b>Ship to</b><br>${esc(shipTo).replace(/\n/g, "<br>")}</p>
<p style="margin:14px 0 0;font-size:13px;color:#52525b;">AMBIT reference: ${esc(ref)} · Questions: ${esc(ORDERS_EMAIL)} · 817-677-1200</p>
<p style="margin:18px 0 0;"><a href="${origin}/store/${partnerId}/desk/orders" style="display:inline-block;background:#0a0a0b;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 18px;border-radius:8px;">Open my order desk</a></p>`;
        const sent = await sendEmail({
          to: [partner.email],
          fromName: "AMBIT Polyurethane",
          replyTo: ORDERS_EMAIL,
          subject: `AMBIT drop-ship order ${no}: ${items.length} ${items.length === 1 ? "line" : "lines"} for ${order.company_name}`,
          html: partnerWrap(partner, origin, `Order ${no}`, inner),
          text: `AMBIT drop-ship order ${no}. Ship to: ${shipTo.replace(/\n/g, ", ")}. ${items.map((l) => `${l.qty} x ${l.sku} ${l.name}`).join("; ")}. Parts ${usd(subtotal)}. Reference ${ref}.`,
        });
        await db.from("partner_orders").update({ email_status: sent.status.slice(0, 20) }).eq("id", ins.id);
      }
    }
    return { made };
  } catch (e) {
    console.error("drop ship", e);
    return { made: [], error: (e as Error).message };
  }
}
