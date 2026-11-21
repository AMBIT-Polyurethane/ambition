import { createClient } from "@/lib/supabase/server";
import { getPartner, orderNo, partnerMe } from "@/lib/partner-store";
import { DeskOrders, type DeskOrder } from "@/components/partner/desk-orders";

export const metadata = { title: "Orders" };

type Row = Omit<DeskOrder, "no" | "at" | "account" | "subtotal" | "lines" | "ship_cost"> & {
  ship_cost: string | null;
  created_at: string;
  subtotal: string;
  items: { sku: string; name: string; unit: string | null; qty: number; price: number | null; per_lb?: number | null }[];
  customer: { company: string } | null;
};

export default async function DeskOrdersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [partner, me] = await Promise.all([getPartner(slug), partnerMe(slug)]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_orders")
    .select("id, created_at, status, name, company, email, phone, delivery, address, po, notes, tracking, subtotal, has_quote, lang, items, source, ship_to, ambit_ref, ship_cost, customer:partner_customers(company)")
    .eq("partner_id", slug)
    .order("created_at", { ascending: false })
    .limit(400);
  const orders: DeskOrder[] = ((data ?? []) as unknown as Row[]).map((o) => ({
    id: o.id, no: orderNo(partner?.short ?? "", o.id), at: o.created_at, status: o.status, name: o.name, company: o.company, email: o.email, phone: o.phone,
    account: o.customer?.company ?? null, delivery: o.delivery, address: o.address, po: o.po, notes: o.notes, tracking: o.tracking,
    subtotal: Number(o.subtotal), has_quote: o.has_quote, lang: o.lang,
    source: o.source ?? "store", ship_to: o.ship_to ?? null, ambit_ref: o.ambit_ref ?? null, ship_cost: o.ship_cost === null || o.ship_cost === undefined ? null : Number(o.ship_cost),
    lines: (o.items ?? []).map((l) => ({ sku: l.sku, name: l.name, unit: l.unit, qty: Number(l.qty), price: l.price === null ? null : Number(l.price), per_lb: l.per_lb == null ? null : Number(l.per_lb) })),
  }));
  return <DeskOrders slug={slug} orders={orders} readOnly={me.kind !== "owner"} />;
}
