"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { partnerForgot, partnerJoinCreate, partnerJoinFinish, partnerJoinSignIn, partnerResetPassword, partnerSignIn, type PFormState } from "@/app/store/actions";
import { usePartner } from "@/components/partner/ctx";
import { PwRules } from "@/components/pw-rules";

function Go({ children, busy }: { children: React.ReactNode; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="adc-cta block" disabled={pending}>
      {pending ? <><LoaderCircle size={18} className="spin" /> {busy}</> : children}
    </button>
  );
}

function Note({ s }: { s: PFormState }) {
  if (!s) return null;
  if (s.error) return <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {s.error}</div>;
  if (s.ok) return <div className="ptn-ok" role="status"><CircleCheck size={20} aria-hidden="true" /><span>{s.ok}</span></div>;
  return null;
}

export function PSignInForm({ next }: { next: string }) {
  const { store, t, base } = usePartner();
  const [s, act] = useActionState(partnerSignIn, null);
  return (
    <form action={act} className="adc-stack-s" style={{ gap: 14 }}>
      <input type="hidden" name="slug" value={store.slug} />
      <input type="hidden" name="next" value={next} />
      <label className="adc-f"><span>{t.email}</span><input name="email" type="email" required autoComplete="email" /></label>
      <label className="adc-f"><span>{t.password}</span><input name="password" type="password" required autoComplete="current-password" /></label>
      <Note s={s} />
      <Go busy={t.signingIn}>{t.signInBtn}</Go>
      <Link href={`${base}/forgot`} className="ptn-linkbtn">{t.forgot}</Link>
    </form>
  );
}

export function PForgotForm() {
  const { store, t } = usePartner();
  const [s, act] = useActionState(partnerForgot, null);
  return (
    <form action={act} className="adc-stack-s" style={{ gap: 14 }}>
      <input type="hidden" name="slug" value={store.slug} />
      <label className="adc-f"><span>{t.email}</span><input name="email" type="email" required autoComplete="email" /></label>
      <Note s={s} />
      <Go busy="...">{t.sendLink}</Go>
    </form>
  );
}

export function PResetForm() {
  const { store, t, lang } = usePartner();
  const [s, act] = useActionState(partnerResetPassword, null);
  return (
    <form action={act} className="adc-stack-s" style={{ gap: 14 }}>
      <input type="hidden" name="slug" value={store.slug} />
      <label className="adc-f"><span>{t.newPassword}</span><input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
      <PwRules lang={lang === "es" ? "es" : "en"} />
      <label className="adc-f"><span>{t.confirmPassword}</span><input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></label>
      <Note s={s} />
      <Go busy="...">{t.savePassword}</Go>
    </form>
  );
}

export function PJoinForm({ token, mode }: { token: string; mode: "create" | "signin" | "finish" }) {
  const { t, base, lang } = usePartner();
  const [s, act] = useActionState(mode === "create" ? partnerJoinCreate : mode === "signin" ? partnerJoinSignIn : partnerJoinFinish, null);
  return (
    <form action={act} className="adc-stack-s" style={{ gap: 14 }}>
      <input type="hidden" name="token" value={token} />
      {mode === "create" ? (
        <>
          <label className="adc-f"><span>{t.yourName}</span><input name="full_name" required minLength={2} autoComplete="name" /></label>
          <label className="adc-f"><span>{t.makePassword}</span><input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
          <PwRules lang={lang === "es" ? "es" : "en"} />
        </>
      ) : mode === "signin" ? (
        <label className="adc-f"><span>{t.password}</span><input name="password" type="password" required autoComplete="current-password" /></label>
      ) : null}
      <Note s={s} />
      <Go busy="...">{mode === "create" ? t.createLogin : mode === "signin" ? t.signInBtn : t.finish}</Go>
      {mode === "signin" ? <Link href={`${base}/forgot`} className="ptn-linkbtn">{t.forgot}</Link> : null}
    </form>
  );
}
