import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, Gift, LogOut, Package } from "lucide-react";
import { adcAccount } from "@/lib/adc-account";
import { adcSignOut } from "./actions";
import { AdcAuth, AdcDetailsForm, AdcReorder } from "@/components/adc/account";
import { dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: dict(await adcLang()).yourAccount, robots: { index: false } };
}
export const dynamic = "force-dynamic";

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The shopper's ADC account: sign in or make one; then their AM-BUCKS, orders and details. */
export default async function AdcAccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [acct, lang] = await Promise.all([adcAccount(), adcLang()]);
  const t = dict(lang);
  const next = typeof sp.next === "string" && sp.next.startsWith("/adc") ? sp.next.slice(0, 200) : "/adc/account";
  if (!acct) {
    const supabase = await createClient();
    const { data: c } = await supabase.auth.getClaims();
    return (
      <div className="adc-wrap adc-pad">
        <div className="adc-acct-box">
          <h1 className="adc-h1">{t.yourAccount}</h1>
          {c?.claims?.sub ? (
            <>
              <div className="adc-err" role="alert">{t.otherStore}</div>
              <form action={adcSignOut}><button type="submit" className="adc-cta block"><LogOut size={16} aria-hidden="true" /> {t.signOut}</button></form>
            </>
          ) : (
            <AdcAuth next={next} />
          )}
        </div>
      </div>
    );
  }
  // Their "text me" box (database update 0103; off until then).
  const supa = await createClient();
  const { data: me } = await supa.auth.getClaims();
  const { data: smsRow } = me?.claims?.sub ? await supa.from("adc_accounts").select("sms_opt_in").eq("user_id", me.claims.sub).maybeSingle() : { data: null };
  const smsOn = Boolean((smsRow as { sms_opt_in?: boolean } | null)?.sms_opt_in);
  const a = acct.account;
  const worth = usd(acct.points * acct.point_value);
  const locale = lang === "es" ? "es-US" : "en-US";
  return (
    <div className="adc-wrap adc-pad adc-stack-s">
      {sp.welcome ? <div className="adc-ok" role="status"><CircleCheck size={18} aria-hidden="true" /> {t.welcome}</div> : null}
      <div className="adc-acct-h">
        <span className="adc-acct-av" aria-hidden="true">{(a?.name ?? acct.email).slice(0, 1).toUpperCase()}</span>
        <span className="adc-acct-t"><h1 className="adc-h1">{a?.name || t.yourAccount}</h1><span className="adc-muted">{[a?.company, acct.email].filter(Boolean).join(" · ")}</span></span>
        <form action={adcSignOut}><button type="submit" className="adc-ghost dark"><LogOut size={16} aria-hidden="true" /> {t.signOut}</button></form>
      </div>
      {!acct.verified ? <div className="adc-err" role="alert">{t.notVerified}</div> : null}

      <section className="adc-bucks" aria-label={t.bucksTitle}>
        <Gift size={28} aria-hidden="true" />
        <span className="adc-bucks-t">
          <span className="adc-sku">{t.bucksTitle}</span>
          <b>{t.bucksWorth(acct.points.toLocaleString("en-US"), worth)}</b>
          <span className="adc-muted small">{t.bucksHow}</span>
        </span>
      </section>

      <div className="adc-acct-grid">
        <section className="adc-stack-s" aria-label={t.yourOrders}>
          <h2 className="adc-h2">{t.yourOrders}</h2>
          {acct.orders.length ? (
            acct.orders.map((o) => (
              <div key={o.id} className="adc-ord">
                <div className="adc-ord-h">
                  <span><b>{o.no}</b><span className="adc-muted small">{new Date(o.at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}</span></span>
                  <span className={`adc-st ${o.status}`}>{t.statusOf[o.status] ?? o.status}</span>
                </div>
                <div className="adc-ord-ls">
                  {o.items.map((l, i) => (
                    <span key={i}><span className="ellipsis">{l.qty} × {l.name}</span><b>{l.price === null ? t.toConfirm : usd(l.price * l.qty)}</b></span>
                  ))}
                </div>
                <div className="adc-ord-f">
                  <span className="adc-muted small">{o.paid_total !== null ? `${usd(o.paid_total)}${o.points ? ` · +${o.points} pts` : ""}` : `${usd(o.subtotal)}${o.has_quote ? " +" : ""}`}</span>
                  {o.status !== "cancelled" ? <AdcReorder items={o.items} /> : null}
                </div>
              </div>
            ))
          ) : (
            <div className="adc-empty"><Package size={26} aria-hidden="true" /><b>{t.noOrders}</b><Link href="/adc" className="adc-cta">{t.shopAll}</Link></div>
          )}
          {acct.history.length ? (
            <details className="adc-hist">
              <summary>{t.bucksHistory}</summary>
              {acct.history.map((h, i) => (
                <span key={i}><span>{new Date(h.at).toLocaleDateString(locale, { month: "short", day: "numeric" })} · {h.note ?? h.kind}</span><b>{h.points > 0 ? "+" : ""}{h.points}</b></span>
              ))}
            </details>
          ) : null}
        </section>
        <section className="adc-acct-card" aria-label={t.saveDetails}>
          <AdcDetailsForm d={{ name: a?.name ?? "", company: a?.company ?? "", phone: a?.phone ?? "", street: a?.street ?? "", city: a?.city ?? "", state: a?.state ?? "", zip: a?.zip ?? "", promo: a?.promo_opt_in ?? true, sms: smsOn }} />
        </section>
      </div>
    </div>
  );
}
