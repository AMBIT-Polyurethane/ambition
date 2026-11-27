"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";

/** Staff: move an ADC web order along (working on it, done, cancelled) with a note. */
export async function setAdcOrderStatus(f: FormData) {
  const { supabase, profile } = await requireActive();
  const id = Number(f.get("id"));
  const status = String(f.get("status") ?? "");
  if (!id || !["new", "working", "done", "cancelled"].includes(status)) return;
  const note = String(f.get("note") ?? "").trim().slice(0, 1000);
  await supabase
    .from("adc_orders")
    .update({ status, staff_note: note || null, handled_by: profile.id, handled_by_name: profile.full_name ?? profile.email, handled_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/orders/web");
}

export type PayState = { ok?: string; error?: string } | null;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** Staff: they paid. Saves what they paid, takes off AM-BUCKS they used, and posts the 3% they earned. */
export async function markAdcPaid(_: PayState, f: FormData): Promise<PayState> {
  const { supabase, profile } = await requireActive();
  if (!(profile.role === "admin" || can(profile, "order_desk"))) return { error: "Only the order desk can do this." };
  const id = Number(f.get("id"));
  const total = num(f.get("total"));
  const used = String(f.get("bucks") ?? "").trim() ? num(f.get("bucks")) : 0;
  if (!id) return { error: "Order not found." };
  if (!Number.isFinite(total) || total < 0) return { error: "Type what they paid for the goods, like 1250.00" };
  if (!Number.isFinite(used) || used < 0) return { error: "AM-BUCKS used should be a dollar amount, like 24.00 (or leave it empty)." };
  const { data, error } = await supabase.rpc("adc_order_mark_paid", { p_id: id, p_total: total, p_bucks_used: used, p_note: String(f.get("note") ?? "") });
  if (error) return { error: error.message.replace(/^.*?: /, "") || "Could not save that." };
  revalidatePath("/orders/web");
  const r = (data ?? {}) as { points?: number; account?: boolean; used?: number };
  if (!r.account) return { ok: "Marked paid. They have no ADC account, so no AM-BUCKS were posted." };
  return { ok: `Marked paid. ${r.points ?? 0} points posted ($${((r.points ?? 0) / 100).toFixed(2)} in AM-BUCKS)${r.used ? `, ${r.used} points used` : ""}.` };
}

/** Staff: flag a web order as a test (it never counts for AM-BUCKS or reports). */
export async function setAdcTest(f: FormData) {
  const { supabase, profile } = await requireActive();
  if (!(profile.role === "admin" || can(profile, "order_desk"))) return;
  const id = Number(f.get("id"));
  if (!id) return;
  await supabase.from("adc_orders").update({ is_test: f.get("on") === "1" }).eq("id", id);
  revalidatePath("/orders/web");
}

/** Admins: remove a test (or cancelled) web order for good. */
export async function deleteAdcTest(f: FormData) {
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin") return;
  const id = Number(f.get("id"));
  if (!id) return;
  await supabase.rpc("adc_order_delete_test", { p_id: id });
  revalidatePath("/orders/web");
}

/** Staff: run the Best Strategy again with today's stock (after a count, a transfer or a vendor set on a product). */
export async function recalcAdcStrategy(f: FormData) {
  const { supabase, profile } = await requireActive();
  if (!(profile.role === "admin" || can(profile, "order_desk") || can(profile, "ordering"))) return;
  const id = Number(f.get("id"));
  if (!id) return;
  const { data } = await supabase.from("adc_orders").select("id, delivery, pickup_branch, address, items, site, unload").eq("id", id).maybeSingle();
  const o = data as { id: number; delivery: "ship" | "pickup" | "truckload"; pickup_branch: string | null; address: { zip: string } | null; items: { product_id?: string | null; sku: string; name: string; qty: number }[]; site: string | null; unload: string | null } | null;
  if (!o) return;
  const { planOrder } = await import("@/lib/adc-logistics");
  const { serviceClient, serviceReady } = await import("@/lib/supabase/service");
  const strategy = await planOrder(serviceReady() ? serviceClient() : supabase, {
    lines: o.items.map((l) => ({ product_id: l.product_id ?? null, sku: l.sku, name: l.name, qty: Number(l.qty) })),
    delivery: o.delivery,
    zip: o.address?.zip ?? "",
    pickup_branch: o.pickup_branch,
    site: { site: o.site === "home" ? "home" : "business", unload: o.unload === "liftgate" ? "liftgate" : o.unload === "forklift" ? "forklift" : "dock" },
  });
  await supabase.from("adc_orders").update({ strategy }).eq("id", id);
  revalidatePath(`/orders/web/${id}/strategy`);
  revalidatePath("/orders/web");
}

/**
 * Staff: Accept a web order. It becomes a ready-to-send order in the normal order screen (the customer, the location
 * from the Best Strategy, the address and the items, with the ISO drum for every spray foam set). Placing it there
 * holds the stock and puts it on PENDING ORDERS like any other order.
 */
export async function acceptAdcOrder(f: FormData) {
  const { supabase, profile } = await requireActive();
  if (!(profile.role === "admin" || can(profile, "order_desk") || can(profile, "ordering"))) return;
  const id = Number(f.get("id"));
  if (!id) return;
  const { data } = await supabase.from("adc_orders").select("*").eq("id", id).maybeSingle();
  type Item = { product_id?: string | null; sku: string; name: string; qty: number; set?: boolean; price?: number | null; promo?: string | null };
  type Strat = { best: string | null; options: { key: string; shipments: { from: string; kind: string; weight: number }[] }[] } | null;
  const o = data as {
    id: number; name: string; company: string | null; email: string; phone: string; delivery: string; pickup_branch: string | null; notes: string | null;
    address: { street: string; street2?: string; city: string; state: string; zip: string } | null; items: Item[]; company_id: string | null; strategy: Strat; ship_est: number | null;
  } | null;
  if (!o) return;

  // Where it ships from: the pickup location, or the location sending the most weight in the Best Strategy.
  let branch: string | null = o.delivery === "pickup" ? o.pickup_branch : null;
  const best = o.strategy?.options.find((x) => x.key === o.strategy?.best);
  if (!branch && best) {
    const byWeight = new Map<string, number>();
    for (const s of best.shipments) if (s.kind !== "vendor" && s.from && s.from !== "vendor") byWeight.set(s.from, (byWeight.get(s.from) ?? 0) + Number(s.weight));
    branch = [...byWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  // Items: the web lines, plus one ISO (A-side) drum for every spray foam set. Gun parts are drop shipped (0104).
  const pids = o.items.map((l) => l.product_id).filter((x): x is string => Boolean(x));
  const { data: ds } = pids.length ? await supabase.from("products").select("id, drop_ship_partner, vendor_name").in("id", pids) : { data: [] };
  const dropShip = new Map(((ds ?? []) as { id: string; drop_ship_partner?: string | null; vendor_name: string | null }[]).filter((x) => x.drop_ship_partner).map((x) => [x.id, x.vendor_name ?? "the vendor"]));
  const items: { raw: string; product_id: string | null; qty: number; confidence: number; note: string | null }[] = o.items.map((l) => ({
    raw: `${l.sku} ${l.name}`, product_id: l.product_id ?? null, qty: Number(l.qty), confidence: l.product_id ? 1 : 0,
    note:
      [
        !l.product_id ? "Not in the catalog: price and add by hand" : dropShip.has(l.product_id) ? `Drop ship from ${dropShip.get(l.product_id)}: don't pick. It goes to them when credit is released.` : "",
        // The price the customer saw on their web order (their price, a sale price): charge this on the invoice.
        l.promo && l.price !== null && l.price !== undefined ? `Web order price $${Number(l.price).toFixed(2)} each (${l.promo}): use it on the invoice.` : "",
      ]
        .filter(Boolean)
        .join(" ") || null,
  }));
  const sets = o.items.filter((l) => l.set).reduce((n, l) => n + Number(l.qty), 0);
  if (sets > 0) {
    const { data: iso } = await supabase.from("products").select("id, sku, name").eq("sku", "ISO").eq("active", true).maybeSingle();
    if (iso) items.push({ raw: `${(iso as { sku: string }).sku} ${(iso as { name: string }).name}`, product_id: (iso as { id: string }).id, qty: sets, confidence: 1, note: "ISO A-side for the spray foam sets" });
  }
  const a = o.address;
  const notes = [
    `ADC web order ADC-${1000 + o.id} from ${o.name} (${o.phone}, ${o.email}).`,
    o.ship_est !== null && o.delivery !== "pickup" ? `Customer was shown $${Number(o.ship_est).toFixed(2)} estimated shipping.` : "",
    best && best.shipments.length > 1 ? "Best Strategy has more than one shipment: see the sheet." : "",
    o.notes ?? "",
  ].filter(Boolean).join(" ").slice(0, 2000);

  const { data: draft, error } = await supabase
    .from("order_drafts")
    .insert({
      created_by: profile.id,
      created_by_name: profile.full_name || profile.email,
      source_text: `ADC web order ADC-${1000 + o.id}`,
      customer_text: o.company || o.name,
      company_id: o.company_id,
      branch_id: branch,
      delivery_method: o.delivery === "pickup" ? "pickup" : "jobsite",
      ship_address: o.delivery === "pickup" || !a ? null : `${a.street}${a.street2 ? `, ${a.street2}` : ""}, ${a.city}, ${a.state} ${a.zip}`,
      notes,
      items,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !draft) {
    console.error("accept web order: draft failed", error?.message);
    return;
  }
  await supabase
    .from("adc_orders")
    .update({ status: "working", staff_note: `Accepted: entering it as an A.I. order`, handled_by: profile.id, handled_by_name: profile.full_name ?? profile.email, handled_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/orders/web");
  redirect(`/order?draft=${(draft as { id: string }).id}`);
}
