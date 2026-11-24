import Link from "next/link";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPartner, partnerMe } from "@/lib/partner-store";
import { currentOrigin } from "@/lib/origin";
import { DeskPrices, type DeskItem } from "@/components/partner/desk-prices";

type Row = Omit<DeskItem, "ambit" | "cost" | "price" | "qty_on_hand"> & { product_id: string | null; cost: string | null; price: string | null; qty_on_hand: string | null };
const n = (v: string | null) => (v === null ? null : Number(v));

export default async function DeskPriceSheet({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const me = await partnerMe(slug);
  const supabase = await createClient();
  const [{ data }, ambitRes, p, custRes, origin] = await Promise.all([
    supabase
      .from("partner_items")
      .select("id, product_id, sku, name, description, category, unit, image_url, cost, price, per_customer, qty_on_hand, active, sort")
      .eq("partner_id", slug)
      .order("sort")
      .order("name")
      .limit(5000),
    // What AMBIT charges this store for the items it buys from AMBIT (0114); empty before that update.
    supabase.rpc("partner_ambit_prices", { p_partner: slug }),
    getPartner(slug),
    supabase.from("partner_customers").select("id, user_id, invited_at").eq("partner_id", slug).eq("active", true).limit(2000),
    currentOrigin(),
  ]);
  const items: DeskItem[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id, sku: r.sku, name: r.name, description: r.description, category: r.category, unit: r.unit, image_url: r.image_url,
    cost: n(r.cost), price: n(r.price), per_customer: r.per_customer, qty_on_hand: n(r.qty_on_hand), active: r.active, ambit: Boolean(r.product_id),
  }));
  const ambit: Record<string, number> = {};
  for (const a of (ambitRes.error ? [] : ambitRes.data ?? []) as { item_id: string; ambit_price: number | null }[]) {
    if (a.ambit_price !== null) ambit[a.item_id] = Number(a.ambit_price);
  }

  // Getting started: the four things that make the store ready for his customers.
  const live = items.filter((i) => i.active);
  const sellable = live.filter((i) => !i.per_customer);
  const priced = sellable.filter((i) => i.price !== null).length;
  const custs = (custRes.data ?? []) as { id: string; user_id: string | null; invited_at: string | null }[];
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  const shipSet = Boolean(p && (has(p.ship_flat) || has(p.ship_free_over) || has(p.ship_note)));
  const steps = [
    { done: sellable.length > 0 && priced === sellable.length, title: "Sell prices", text: `${priced} of ${sellable.length} items have a sell price`, href: `/store/${slug}/desk` },
    { done: shipSet, title: "Shipping", text: shipSet ? "Set" : "Flat rate, free over an amount, or a note", href: `/store/${slug}/desk/store` },
    { done: custs.length > 0, title: "Customers", text: custs.length ? `${custs.length} added · ${custs.filter((c) => c.user_id).length} signed in` : "Add them and send their logins", href: `/store/${slug}/desk/customers` },
    { done: custs.some((c) => c.user_id), title: "Share your store", text: `${origin.replace(/^https?:\/\//, "")}/store/${slug}`, href: `/store/${slug}` },
  ];
  const left = steps.filter((s) => !s.done).length;
  return (
    <>
      {sp.welcome && me.kind === "owner" ? (
        <div className="ptn-ok" style={{ marginBottom: 18 }}>
          <span><b>Welcome to your store desk{me.name ? `, ${me.name.split(/\s+/)[0]}` : ""}.</b> Start here: check your purchase and sell prices. Then add your customers and send them their logins.</span>
        </div>
      ) : null}
      {left ? (
        <section className="ptn-start" aria-label="Getting your store ready">
          <b className="ptn-start-h">Getting your store ready · {4 - left} of 4 done</b>
          <ol className="ptn-start-l">
            {steps.map((s, i) => (
              <li key={s.title} className={s.done ? "done" : undefined}>
                <span className="ptn-start-n" aria-hidden="true">{s.done ? <Check size={14} /> : i + 1}</span>
                <Link href={s.href} className="ptn-start-t"><b>{s.title}</b><span>{s.text}</span></Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <DeskPrices slug={slug} items={items} readOnly={me.kind !== "owner"} ambit={ambit} />
    </>
  );
}
