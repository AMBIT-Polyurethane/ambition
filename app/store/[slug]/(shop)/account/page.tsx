import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, LogOut, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPartner, orderNo, partnerCatalog, partnerMe } from "@/lib/partner-store";
import { adcLang } from "@/lib/adc-lang";
import { pdict, usd } from "@/lib/partner-i18n";
import { partnerSignOut } from "@/app/store/actions";
import { POrderCard, type POrderView } from "@/components/partner/account";

export const metadata = { title: "Your account" };

type Row = { id: number; created_at: string; status: string; tracking: string | null; po: string | null; subtotal: number; has_quote: boolean; items: { item_id: string | null; sku: string; name: string; qty: number; price: number | null; per_lb?: number | null }[] };

/** A customer's account on the store: their company, their orders, "Order again". */
export default async function PartnerAccount({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const [me, lang, all, partner] = await Promise.all([partnerMe(slug), adcLang(), partnerCatalog(slug), getPartner(slug)]);
  const t = pdict(lang);
  if (me.kind === "guest") redirect(`/store/${slug}/signin`);
  if (me.kind === "owner" || me.kind === "viewer") redirect(`/store/${slug}/desk`);
  if (me.kind === "other") {
    return (
      <div className="adc-wrap adc-pad">
        <div className="ptn-signin">
          <div className="adc-err" role="alert">{t.notHere}</div>
          <form action={partnerSignOut}><input type="hidden" name="slug" value={slug} /><button type="submit" className="adc-cta block"><LogOut size={16} aria-hidden="true" /> {t.signOut}</button></form>
        </div>
      </div>
    );
  }
  const c = me.customer;
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_orders")
    .select("id, created_at, status, tracking, po, subtotal, has_quote, items")
    .eq("partner_id", slug)
    .eq("customer_id", c.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const img = new Map(all.map((i) => [i.id, i.image]));
  const orders: POrderView[] = ((data ?? []) as Row[]).map((o) => ({
    no: orderNo(partner?.short ?? slug.toUpperCase(), o.id),
    at: o.created_at,
    status: o.status,
    tracking: o.tracking,
    po: o.po,
    subtotal: Number(o.subtotal),
    has_quote: o.has_quote,
    lines: (o.items ?? []).map((l) => ({ item_id: l.item_id, sku: l.sku, name: l.name, qty: Number(l.qty), price: l.price === null ? null : Number(l.price), per_lb: l.per_lb == null ? null : Number(l.per_lb), image: l.item_id ? img.get(l.item_id) ?? null : null })),
  }));
  const spent = orders.filter((o) => o.status !== "cancelled").reduce((n, o) => n + o.subtotal, 0);
  return (
    <div className="adc-wrap adc-pad adc-stack-s">
      {sp.welcome ? <div className="ptn-ok"><CircleCheck size={20} aria-hidden="true" /><span>{t.welcomeBack((me.name ?? "").split(/\s+/)[0] || c.company, c.company)}</span></div> : null}
      <div className="ptn-acct-h">
        <span className="ptn-av" aria-hidden="true">{c.company.slice(0, 1).toUpperCase()}</span>
        <span className="ptn-acct-t"><h1 className="adc-h1">{c.company}</h1><span className="adc-muted">{[me.name ?? c.contact, me.email, c.terms].filter(Boolean).join(" · ")}</span></span>
        <form action={partnerSignOut}><input type="hidden" name="slug" value={slug} /><button type="submit" className="adc-ghost dark"><LogOut size={16} aria-hidden="true" /> {t.signOut}</button></form>
      </div>
      <div className="ptn-stats">
        <span><b>{orders.length}</b><span>{t.orders}</span></span>
        <span><b>{usd(spent)}</b><span>{t.orderedWithUs}</span></span>
        <span><b>{orders.filter((o) => o.status === "new" || o.status === "shipped").length}</b><span>{t.onTheWay}</span></span>
        <span><b>{c.terms || "-"}</b><span>{t.terms}</span></span>
      </div>
      <h2 className="adc-h2">{t.orderHistory}</h2>
      {orders.length ? (
        <div className="ptn-orders">{orders.map((o) => <POrderCard key={o.no} o={o} />)}</div>
      ) : (
        <div className="adc-empty"><Package size={28} aria-hidden="true" /><b>{t.noOrders}</b><Link href={`/store/${slug}`} className="adc-cta">{t.shopAll}</Link></div>
      )}
    </div>
  );
}
