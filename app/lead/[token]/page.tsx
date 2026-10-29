import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logoUrl } from "@/lib/ops/server";
import { LeadRequestForm } from "./request-form";

// A contractor's public "Request a quote" form (AMBIT-OPS). No account needed: the link is the key.
export const metadata: Metadata = { title: "Request a quote", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function LeadFormPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("ops_lead_form", { p_token: token });
  const f = ((data ?? []) as { company_name: string; logo_path: string | null; services: string[]; color: string | null }[])[0];
  const embed = sp.embed === "1";
  const accent = f?.color && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : "#e33527";
  return (
    <div className={`theme-light approve-page lead-page${embed ? " embed" : ""}`} style={{ ["--lead-accent" as string]: accent }}>
      <main className="shell no-tabs" style={{ maxWidth: 600 }}>
        {!f ? (
          <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>This form isn&apos;t taking requests right now. Please call the company directly.</span></div>
        ) : (
          <>
            <header className="lead-head">
              {f.logo_path ? <img src={logoUrl(f.logo_path)!} alt={f.company_name} className="lead-logo" /> : <b className="lead-name">{f.company_name}</b>}
            </header>
            <div className="col tight">
              <h1 className="h1" style={{ margin: 0 }}>Request a free quote</h1>
              <span className="muted">Tell {f.company_name} about your project and they&apos;ll get back to you.</span>
            </div>
            <LeadRequestForm token={token} services={f.services} company={f.company_name} />
            <p className="tiny faint center" style={{ margin: "8px 0 0" }}>Your information goes only to {f.company_name}. · Powered by AMBIT-OPS</p>
          </>
        )}
      </main>
    </div>
  );
}
