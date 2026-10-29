import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logoUrl } from "@/lib/ops/server";
import { proposalOf } from "@/lib/ops/proposal";
import { ProposalView } from "./proposal-view";

// A contractor's proposal for their customer (AMBIT-OPS). No account needed: the link is the key.
export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, { data: docs }] = await Promise.all([
    supabase.rpc("ops_proposal", { p_token: token, p_count: true }),
    supabase.rpc("ops_proposal_docs", { p_token: token }),
  ]);
  const p = proposalOf(data);
  const accent = p?.company.color && /^#[0-9a-f]{6}$/i.test(p.company.color) ? p.company.color : "#e33527";
  return (
    <div className="theme-light approve-page lead-page prop-page" style={{ ["--lead-accent" as string]: accent }}>
      <main className="shell no-tabs" style={{ maxWidth: 760 }}>
        {!p ? (
          <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>This proposal link isn&apos;t valid. Ask the company that sent it for a new link.</span></div>
        ) : (
          <ProposalView p={p} token={token} logo={logoUrl(p.company.logo_path)} docs={((docs ?? []) as { title: string; doc_type: string; url: string }[]).filter((d) => /^https:\/\//.test(d.url))} />
        )}
      </main>
    </div>
  );
}
