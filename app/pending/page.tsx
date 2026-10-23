import { redirect } from "next/navigation";
import { Clock, Lock } from "lucide-react";
import { getSession } from "@/lib/session";
import { firstName } from "@/lib/format";
import { DeleteAccount } from "@/components/delete-account";

export const metadata = { title: "Account pending" };

export default async function PendingPage() {
  const s = await getSession();
  if (!s) redirect("/signin");
  if (s.profile?.status === "active") redirect("/");
  const disabled = s.profile?.status === "disabled";

  return (
    <main className="auth">
      <div className="swoosh" aria-hidden="true" />
      <div className="col" style={{ gap: 18, marginTop: 60, position: "relative" }}>
        <div className="done-mark">{disabled ? <Lock size={36} /> : <Clock size={36} />}</div>
        <h1 className="h1 center">{disabled ? "This account is turned off" : `Thanks, ${firstName(s.profile?.full_name, s.user.email)}`}</h1>
        <p className="muted center">
          {disabled
            ? "Your access to AMBITION has been turned off. If you think this is a mistake, contact your AMBIT rep."
            : "AMBIT is reviewing your request and linking your login to your company account. You'll get an email as soon as you're approved, usually within one business day."}
        </p>
        {!disabled && s.profile?.requested_company ? (
          <div className="card small">
            <div className="faint tiny" style={{ marginBottom: 6 }}>REQUEST</div>
            <div><b>{s.profile.requested_company}</b>{s.profile.requested_account_no ? ` · ${s.profile.requested_account_no}` : ""}</div>
            <div className="muted">{s.user.email}</div>
          </div>
        ) : null}
        <p className="muted center small">
          Need something now? Email <a href="mailto:orders@ambitpu.com">orders@ambitpu.com</a>.
        </p>
        <form action="/auth/signout" method="post">
          <button className="btn dark block" type="submit">Sign out</button>
        </form>
        <DeleteAccount email={s.user.email ?? s.profile?.email ?? ""} />
      </div>
    </main>
  );
}
