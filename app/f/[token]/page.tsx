import type { Metadata } from "next";
import { CircleAlert, CircleCheck, Lock } from "lucide-react";
import { serviceClient } from "@/lib/supabase/service";
import { SPECS } from "@/lib/forms/specs";
import type { Data } from "@/lib/forms/engine";
import { FormRunner } from "@/components/forms/form-runner";

// A customer's own link to the Credit Application or Account Setup. No account needed: the link is the key.
export const metadata: Metadata = { title: "AMBIT Polyurethane", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await serviceClient().from("form_submissions").select("id, form_key, status, data, token_expires, submitted_name").eq("public_token", token).maybeSingle();
  const r = data as { id: number; form_key: string; status: string; data: Data; token_expires: string | null; submitted_name: string | null } | null;
  const spec = r ? SPECS[r.form_key] : null;
  const expired = r?.token_expires ? new Date(r.token_expires) < new Date() : false;
  return (
    <div className="theme-light approve-page">
      <main className="shell no-tabs fx-shell">
        <header className="fx-public-head">
          <span className="fx-brand">AMBIT<span> POLYURETHANE</span></span>
          <span className="tiny faint"><Lock size={11} /> Secure form</span>
        </header>
        {!r || !spec?.publicLink ? (
          <div className="alert err"><CircleAlert size={18} /><span>This link isn&apos;t valid. Please ask your AMBIT rep for a new one.</span></div>
        ) : !["sent", "draft"].includes(r.status) ? (
          <div className="alert ok"><CircleCheck size={18} /><span>Thank you! AMBIT has your {spec.title.toLowerCase()}. Your rep will be in touch soon.</span></div>
        ) : expired ? (
          <div className="alert err"><CircleAlert size={18} /><span>This link has expired. Please ask your AMBIT rep for a new one.</span></div>
        ) : (
          <>
            <div className="col tight">
              <h1 className="h1" style={{ margin: 0 }}>{spec.title}</h1>
              <span className="muted">{r.submitted_name ? `Hi ${r.submitted_name.split(" ")[0]}! ` : ""}It takes about 5 minutes. Your answers save as you go, so you can come back to this link.</span>
            </div>
            <FormRunner formKey={r.form_key} initial={r.data} token={token} staff={false} />
            <p className="tiny faint center" style={{ margin: "8px 0 0" }}>AMBIT Polyurethane · 2925 Galleria Drive, Arlington, TX 76011 · (817) 677-1200. Private numbers are encrypted and only seen by our Accounting team.</p>
          </>
        )}
      </main>
    </div>
  );
}
