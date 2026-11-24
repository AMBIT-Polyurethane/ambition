import type { SupabaseClient } from "@supabase/supabase-js";

// Unofficial estimates (0108): a sales rep lists the items (prices come from the customer's price list and can't
// be changed), a CRM adds the quoted freight, the tax comes from the tax rate table, then the rep or a CRM emails it.

export type EstimateStatus = "draft" | "needs_freight" | "ready" | "sent" | "converted" | "cancelled";

export const ESTIMATE_STATUS: Record<EstimateStatus, { label: string; pill: string; hint: string }> = {
  draft: { label: "Draft", pill: "grey", hint: "The rep is still building it" },
  needs_freight: { label: "Needs freight", pill: "warn", hint: "Waiting for a CRM to add the freight" },
  ready: { label: "Ready to send", pill: "ok", hint: "Freight and tax are in: send it to the customer" },
  sent: { label: "Sent", pill: "info", hint: "Emailed to the customer" },
  converted: { label: "Ordered", pill: "ok", hint: "Turned into an order" },
  cancelled: { label: "Cancelled", pill: "grey", hint: "" },
};

export type Estimate = {
  id: string;
  est_no: number;
  company_id: string;
  company_name: string;
  status: EstimateStatus;
  created_by: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  delivery_method: "pickup" | "jobsite";
  branch_id: string | null;
  ship_address: string | null;
  ship_state: string | null;
  ship_zip: string | null;
  customer_note: string | null;
  staff_note: string | null;
  priced_on: string | null;
  subtotal: number;
  has_unpriced: boolean;
  freight: number | null;
  freight_note: string | null;
  freight_by_name: string | null;
  freight_at: string | null;
  tax_rate: number | null;
  tax_rate_manual: boolean;
  tax_freight: boolean;
  tax_source: string | null;
  tax_exempt: boolean;
  tax: number | null;
  total: number | null;
  valid_until: string | null;
  sent_at: string | null;
  sent_to: string | null;
  sent_by_name: string | null;
  order_id: string | null;
  converted_at: string | null;
  converted_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type EstimateItem = {
  id: number;
  sort: number;
  product_id: string | null;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unit_price: number | null;
  line_total: number | null;
  price_parts: { with: number | null; qty: number; price: number }[] | null;
  basis: string | null;
  per_price: number | null;
  price_source: string | null;
};

export type TaxRate = { id: number; kind: "branch" | "zip" | "state"; key: string; rate: number; tax_freight: boolean; label: string | null; updated_by_name: string | null; updated_at: string };

export const estNo = (n: number) => `EST-${n}`;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** One estimate with its lines (null when it isn't there or this person can't see it). */
export async function loadEstimate(db: SupabaseClient, id: string): Promise<{ est: Estimate; items: EstimateItem[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data: e }, { data: rows }] = await Promise.all([
    db.from("estimates").select("*").eq("id", id).maybeSingle(),
    db.from("estimate_items").select("*").eq("estimate_id", id).order("sort").order("id"),
  ]);
  if (!e) return null;
  const est = e as Estimate;
  for (const k of ["subtotal", "freight", "tax_rate", "tax", "total"] as const) (est as Record<string, unknown>)[k] = num(est[k]);
  const items = ((rows ?? []) as EstimateItem[]).map((r) => ({
    ...r,
    qty: Number(r.qty),
    unit_price: num(r.unit_price),
    line_total: num(r.line_total),
    per_price: num(r.per_price),
  }));
  return { est, items };
}

/** "Pickup at Oklahoma City" / "Delivered to 100 Main St, Addison TX 75001". */
export function deliveryText(e: Pick<Estimate, "delivery_method" | "ship_address" | "ship_state" | "ship_zip">, branchName: string | null): string {
  if (e.delivery_method === "pickup") return `Pickup at ${branchName ?? "AMBIT"}`;
  return `Delivered to ${[e.ship_address, [e.ship_state, e.ship_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}`;
}

/** The ISO drum's price, explained: "$975.00 with AMBI-TITE (2) + $800.00 with AMBI-SEAL (1)". */
export function partsText(it: EstimateItem, items: EstimateItem[], money: (n: number) => string): string | null {
  if (!it.price_parts?.length) return null;
  // "with" counts the lines that have an item (the order the database priced them in).
  const priced = items.filter((x) => x.product_id);
  return it.price_parts
    .map((p) => {
      const w = p.with === null ? null : priced[p.with];
      return `${p.qty} at ${money(p.price)}${w ? ` (with ${w.sku})` : " (extra)"}`;
    })
    .join(" + ");
}
