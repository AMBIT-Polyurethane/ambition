import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/invites";
import { BrandImg } from "@/components/brand";
import { Submit } from "@/components/forms";
import { JoinCreateForm, JoinSignInForm } from "@/components/join-forms";
import { joinFinish } from "../actions";

export const metadata = { title: "Set up your AMBITION login" };
export const dynamic = "force-dynamic";

type Info = { email: string; full_name: string | null; phone: string | null; kind: string; company_name: string | null; invited_by_name: string | null; state: string; has_account: boolean };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, { data: auth }] = await Promise.all([
    supabase.rpc("invite_lookup", { p_hash: hashToken(token) }),
    supabase.auth.getUser(),
  ]);
  const info = (Array.isArray(data) ? data[0] : data) as Info | undefined;
  const signedInAs = auth.user?.email?.toLowerCase() ?? null;

  return (
    <main className="auth">
      <div className="swoosh" aria-hidden="true" />
      <div className="col" style={{ alignItems: "center", gap: 12, marginTop: 30, position: "relative" }}>
        <BrandImg art="atom-mark" width={88} height={88} />
        <div className="wordmark" style={{ fontSize: 30 }}>AMBIT<span>ION</span></div>
      </div>

      <div className="col" style={{ marginTop: 28, gap: 16, position: "relative" }}>
        {!info || info.state !== "open" ? (
          <>
            <div className="alert warn">
              {info?.state === "used"
                ? "This invite was already used, so your login is set up. Sign in with your email and password."
                : "This invite link has expired or was replaced by a newer one. Ask AMBIT to send you a new invite."}
            </div>
            <Link href="/signin" className="btn block">Go to sign in</Link>
          </>
        ) : (
          <>
            <div className="col" style={{ gap: 6 }}>
              <h1 className="h2" style={{ margin: 0 }}>
                {info.full_name ? `Welcome, ${info.full_name.split(/\s+/)[0]}.` : "Welcome to AMBITION."}
              </h1>
              <p className="muted small" style={{ margin: 0 }}>
                {info.invited_by_name ?? "AMBIT"} set up your account
                {info.kind === "employee" ? " on the AMBIT team side of the app." : info.company_name ? ` for ${info.company_name}.` : "."}
                {info.has_account ? " Sign in to finish." : " Create a password to finish."}
              </p>
            </div>
            <div className="card small">
              <div className="faint tiny" style={{ marginBottom: 4 }}>YOUR LOGIN EMAIL</div>
              <b>{info.email}</b>
            </div>
            {signedInAs === info.email.toLowerCase() ? (
              <form action={joinFinish}>
                <input type="hidden" name="token" value={token} />
                <Submit pendingText="One moment…">Finish setting up</Submit>
              </form>
            ) : info.has_account ? (
              <JoinSignInForm token={token} />
            ) : (
              <JoinCreateForm token={token} name={info.full_name ?? ""} phone={info.phone ?? ""} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
