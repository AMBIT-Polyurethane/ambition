import Link from "next/link";
import { Eye, Lock, Store } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { OwnerInvite } from "./owner-invite";
import { HandOver } from "./hand-over";

export const metadata = { title: "Distributor stores" };

type P = { id: string; name: string; owner_name: string | null; email: string | null; phone: string | null; active: boolean };

/** AMBIT admin: the distributors that have their own store on AMBIT Intelligence. Only the partner viewer (Jeremiah)
 *  can open a store's desk or invite its owner; nobody else at AMBIT sees their prices, customers or orders. */
export default async function PartnersPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("partners").select("id, name, owner_name, email, phone, active").order("name");
  const partners = (data ?? []) as P[];
  const rows = await Promise.all(
    partners.map(async (p) => {
      const { data: can } = await supabase.rpc("can_view_partner", { p: p.id });
      if (can !== true) return { p, can: false, owner: null as null | { name: string | null; email: string }, invite: null as null | { email: string; at: string } };
      const [{ data: o }, { data: inv }] = await Promise.all([
        supabase.from("profiles").select("full_name, email").eq("partner_id", p.id).eq("partner_role", "owner").limit(1).maybeSingle<{ full_name: string | null; email: string }>(),
        supabase.from("partner_invites").select("email, created_at, accepted_at, expires_at").eq("partner_id", p.id).eq("partner_role", "owner").order("created_at", { ascending: false }).limit(1).maybeSingle<{ email: string; created_at: string; accepted_at: string | null; expires_at: string }>(),
      ]);
      return { p, can: true, owner: o ? { name: o.full_name, email: o.email } : null, invite: inv && !inv.accepted_at && new Date(inv.expires_at) > new Date() ? { email: inv.email, at: inv.created_at } : null };
    }),
  );
  return (
    <main className="shell">
      <TopBar title="Distributor stores" back="/admin" />
      {error ? <div className="alert warn small">Run database update 0096 first (Supabase → SQL Editor).</div> : null}
      <p className="muted small" style={{ margin: 0 }}>
        Each distributor runs their own store: their own prices, customers and orders. AMBIT staff can&apos;t see any of it. Only Jeremiah Bryant can look at a store&apos;s desk (read only).
      </p>
      {rows.map(({ p, can, owner, invite }) => (
        <section key={p.id} className="card col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <Store size={22} aria-hidden="true" />
            <div className="col tight" style={{ flex: 1, minWidth: 0 }}>
              <b>{p.name}</b>
              <span className="small muted">{[p.owner_name, p.email, p.phone].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <Link href={`/store/${p.id}`} className="btn ghost sm"><Store size={16} aria-hidden="true" /> Open the store</Link>
            {can ? <Link href={`/store/${p.id}/desk`} className="btn ghost sm"><Eye size={16} aria-hidden="true" /> Look at the desk (read only)</Link> : null}
          </div>
          {can ? (
            owner ? (
              <>
                <div className="alert ok small" style={{ margin: 0 }}>{owner.name ?? owner.email} has the store login ({owner.email}).</div>
                <HandOver slug={p.id} owner={owner.name ?? p.owner_name ?? "the owner"} email={owner.email} />
              </>
            ) : (
              <OwnerInvite slug={p.id} email={p.email ?? ""} owner={p.owner_name ?? "the owner"} sentTo={invite?.email ?? null} sentAt={invite?.at ?? null} />
            )
          ) : (
            <div className="alert info small" style={{ margin: 0 }}><Lock size={16} aria-hidden="true" /> This store&apos;s prices, customers and orders are private to {p.name}.</div>
          )}
        </section>
      ))}
    </main>
  );
}
