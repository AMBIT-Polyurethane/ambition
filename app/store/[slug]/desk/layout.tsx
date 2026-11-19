import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, LogOut, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPartner, partnerMe } from "@/lib/partner-store";
import { partnerSignOut } from "@/app/store/actions";
import { DeskTabs } from "@/components/partner/desk-tabs";

export const metadata = { title: "Store desk" };

// The store owner's desk. Only the owner (and, to look, AMBIT's partner viewer) gets in.
export default async function DeskLayout({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const [partner, me] = await Promise.all([getPartner(slug), partnerMe(slug)]);
  if (!partner) redirect("/");
  if (me.kind === "guest") redirect(`/store/${slug}/signin?next=${encodeURIComponent(`/store/${slug}/desk`)}`);
  if (me.kind === "customer") redirect(`/store/${slug}/account`);
  if (me.kind === "other") redirect(`/store/${slug}`);
  const supabase = await createClient();
  const { count } = await supabase.from("partner_orders").select("id", { count: "exact", head: true }).eq("partner_id", slug).eq("status", "new");
  return (
    <div className="ptn-desk">
      <header className="ptn-desk-top">
        <div className="adc-wrap ptn-desk-bar">
          <Link href={`/store/${slug}/desk`} className="ptn-logo" aria-label="Store desk">
            {partner.logo_url ? <img src={partner.logo_url} alt={partner.name} /> : <b>{partner.name}</b>}
          </Link>
          <span className="ptn-desk-label">Store desk</span>
          <span className="ptn-desk-sp" />
          <Link href={`/store/${slug}`} className="ptn-acct"><Store size={18} aria-hidden="true" /><span>View store</span></Link>
          {me.kind === "owner" ? (
            <form action={partnerSignOut}>
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="ptn-acct" aria-label="Sign out"><LogOut size={18} aria-hidden="true" /><span>Sign out</span></button>
            </form>
          ) : null}
        </div>
        <DeskTabs slug={slug} newOrders={count ?? 0} />
      </header>
      {me.kind === "viewer" ? (
        <div className="ptn-ro"><Eye size={16} aria-hidden="true" /> Read only. You&apos;re looking at {partner.name}&apos;s desk from AMBIT. Only {partner.owner_name ?? "the owner"} can change things here.</div>
      ) : null}
      <main className="adc-wrap adc-pad ptn-desk-main">{children}</main>
    </div>
  );
}
