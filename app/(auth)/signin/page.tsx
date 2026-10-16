import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth-forms";
import { signInWithMicrosoft } from "@/app/(auth)/actions";
import { Submit } from "@/components/forms";
import { MICROSOFT_SIGNIN } from "@/lib/env";
import { getSession } from "@/lib/session";
import { safeNext } from "@/lib/origin";

export const metadata = { title: "Sign in" };

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const session = await getSession();
  if (session) redirect(next);

  return (
    <main className="auth">
      <div className="swoosh" aria-hidden="true" />
      <div className="col" style={{ alignItems: "center", gap: 14, marginTop: 36, position: "relative" }}>
        <img src="/brand/atom-mark.png" alt="" width={104} height={104} />
        <div className="wordmark" style={{ fontSize: 34 }}>AMBIT<span>ION</span></div>
        <p className="muted center small" style={{ maxWidth: 280, margin: 0 }}>
          Ordering, product docs and training from AMBIT Polyurethane.
        </p>
      </div>

      <div className="col" style={{ marginTop: 40, gap: 14, position: "relative" }}>
        {sp.error === "microsoft" ? (
          <div className="alert err">Microsoft sign-in didn&apos;t finish. Please try again.</div>
        ) : null}
        {sp.error === "link" ? (
          <div className="alert err">That link has expired or was already used. Please sign in or request a new one.</div>
        ) : null}

        {MICROSOFT_SIGNIN ? (
          <>
            <form action={signInWithMicrosoft}>
              <input type="hidden" name="next" value={next} />
              <Submit className="btn block ms" pendingText="Opening Microsoft…">
                <MicrosoftLogo /> AMBIT employees: Sign in with Microsoft
              </Submit>
            </form>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span className="tiny faint">CONTRACTORS</span>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>
          </>
        ) : null}

        <SignInForm next={next} />
        <Link href="/request-access" className="btn ghost block" style={{ marginTop: 6 }}>
          Request contractor access
        </Link>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 36, display: "flex", justifyContent: "center", position: "relative" }}>
        <img src="/brand/logo-white.png" alt="AMBIT Polyurethane" style={{ height: 26, width: "auto", opacity: 0.9 }} />
      </div>
    </main>
  );
}
