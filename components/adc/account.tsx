"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, LoaderCircle, RotateCcw } from "lucide-react";
import { adcForgot, adcNotifyMe, adcResendConfirm, adcResetPassword, adcSaveAccount, adcSignIn, adcSignUp, type AdcFormState } from "@/app/adc/account/actions";
import { useAdc } from "@/components/adc/lang";
import { useAdcCart } from "@/components/adc/cart";
import { PwRules } from "@/components/pw-rules";

function Go({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const { t } = useAdc();
  return (
    <button type="submit" className="adc-cta block" disabled={pending}>
      {pending ? <><LoaderCircle size={18} className="spin" /> {t.working}</> : children}
    </button>
  );
}

function Note({ s }: { s: AdcFormState }) {
  if (!s) return null;
  if (s.error) return <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {s.error}</div>;
  if (s.ok) return <div className="adc-ok" role="status"><CircleCheck size={18} aria-hidden="true" /> {s.ok}</div>;
  return null;
}

function Resend({ email }: { email: string }) {
  const { t } = useAdc();
  const [s, act] = useActionState(adcResendConfirm, null);
  return (
    <form action={act} className="adc-stack-s" style={{ gap: 8 }}>
      <input type="hidden" name="email" value={email} />
      <button type="submit" className="adc-linkbtn">{t.resend}</button>
      {s?.ok && s.sent ? <span className="adc-muted small">{s.ok}</span> : null}
    </form>
  );
}

/** Sign in, or make an account (checked: email me deals). */
export function AdcAuth({ next }: { next: string }) {
  const { t, lang } = useAdc();
  const [tab, setTab] = useState<"in" | "up" | "forgot">("in");
  const [inS, signIn] = useActionState(adcSignIn, null);
  const [upS, signUp] = useActionState(adcSignUp, null);
  const [fgS, forgot] = useActionState(adcForgot, null);
  return (
    <div className="adc-auth">
      <div className="adc-seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "in"} className={tab === "in" ? "on" : undefined} onClick={() => setTab("in")}>{t.signInTitle}</button>
        <button type="button" role="tab" aria-selected={tab === "up"} className={tab === "up" ? "on" : undefined} onClick={() => setTab("up")}>{t.createAccount}</button>
      </div>
      {tab === "in" ? (
        <form action={signIn} className="adc-stack-s" style={{ gap: 14 }}>
          <input type="hidden" name="next" value={next} />
          <label className="adc-f"><span>{t.email}</span><input name="email" type="email" required autoComplete="email" /></label>
          <label className="adc-f"><span>{t.password}</span><input name="password" type="password" required autoComplete="current-password" /></label>
          <Note s={inS} />
          {inS?.sent ? <Resend email={inS.sent} /> : null}
          <Go>{t.signInBtn}</Go>
          <button type="button" className="adc-linkbtn" onClick={() => setTab("forgot")}>{t.forgot}</button>
        </form>
      ) : tab === "up" ? (
        upS?.sent ? (
          <div className="adc-stack-s">
            <div className="adc-ok" role="status"><CircleCheck size={18} aria-hidden="true" /> {upS.ok}</div>
            <Resend email={upS.sent} />
          </div>
        ) : (
          <form action={signUp} className="adc-stack-s" style={{ gap: 14 }}>
            <p className="adc-muted" style={{ margin: 0 }}>{t.createText}</p>
            <div className="adc-f2">
              <label className="adc-f"><span>{t.name}</span><input name="name" required minLength={2} autoComplete="name" /></label>
              <label className="adc-f"><span>{t.company}</span><input name="company" autoComplete="organization" /></label>
              <label className="adc-f"><span>{t.email}</span><input name="email" type="email" required autoComplete="email" /></label>
              <label className="adc-f"><span>{t.phone}</span><input name="phone" type="tel" autoComplete="tel" /></label>
              <label className="adc-f wide"><span>{t.passwordNew}</span><input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
            </div>
            <PwRules lang={lang} />
            <label className="adc-check"><input type="checkbox" name="promo" defaultChecked /> <span>{t.promoOpt}</span></label>
            <input name="website" tabIndex={-1} autoComplete="off" className="adc-hp" aria-hidden="true" />
            <Note s={upS} />
            <Go>{t.createBtn}</Go>
            <p className="adc-muted small" style={{ margin: 0 }}>{t.bucksHow}</p>
          </form>
        )
      ) : (
        <form action={forgot} className="adc-stack-s" style={{ gap: 14 }}>
          <b>{t.forgotTitle}</b>
          <p className="adc-muted" style={{ margin: 0 }}>{t.forgotText}</p>
          <label className="adc-f"><span>{t.email}</span><input name="email" type="email" required autoComplete="email" /></label>
          <Note s={fgS} />
          <Go>{t.sendLink}</Go>
          <button type="button" className="adc-linkbtn" onClick={() => setTab("in")}>{t.signInTitle}</button>
        </form>
      )}
    </div>
  );
}

export function AdcResetForm() {
  const { t, lang } = useAdc();
  const [s, act] = useActionState(adcResetPassword, null);
  return (
    <form action={act} className="adc-stack-s" style={{ gap: 14 }}>
      <label className="adc-f"><span>{t.newPassword}</span><input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
      <PwRules lang={lang} />
      <label className="adc-f"><span>{t.confirmPassword}</span><input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></label>
      <Note s={s} />
      <Go>{t.savePassword}</Go>
    </form>
  );
}

export type AcctDetails = { name: string; company: string; phone: string; street: string; city: string; state: string; zip: string; promo: boolean };

export function AdcDetailsForm({ d }: { d: AcctDetails }) {
  const { t } = useAdc();
  const [s, act] = useActionState(adcSaveAccount, null);
  return (
    <form action={act} className="adc-stack-s" style={{ gap: 14 }}>
      <div className="adc-f2">
        <label className="adc-f"><span>{t.name}</span><input name="name" defaultValue={d.name} autoComplete="name" /></label>
        <label className="adc-f"><span>{t.company}</span><input name="company" defaultValue={d.company} autoComplete="organization" /></label>
        <label className="adc-f"><span>{t.phone}</span><input name="phone" type="tel" defaultValue={d.phone} autoComplete="tel" /></label>
        <label className="adc-f wide"><span>{t.street}</span><input name="street" defaultValue={d.street} autoComplete="address-line1" /></label>
        <label className="adc-f"><span>{t.city}</span><input name="city" defaultValue={d.city} autoComplete="address-level2" /></label>
        <span className="adc-f2 tight">
          <label className="adc-f"><span>{t.state}</span><input name="state" maxLength={2} defaultValue={d.state} autoComplete="address-level1" /></label>
          <label className="adc-f"><span>{t.zip}</span><input name="zip" inputMode="numeric" defaultValue={d.zip} autoComplete="postal-code" /></label>
        </span>
      </div>
      <label className="adc-check"><input type="checkbox" name="promo" defaultChecked={d.promo} /> <span>{t.promoOpt}</span></label>
      <Note s={s} />
      <Go>{t.saveDetails}</Go>
    </form>
  );
}

/** "Order again": the same items go back in the cart. */
export function AdcReorder({ items }: { items: { product_id: string | null; sku: string; name: string; qty: number }[] }) {
  const { add } = useAdcCart();
  const { t } = useAdc();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`adc-add${done ? " done" : ""}`}
      onClick={() => {
        items.forEach((i) => add({ id: i.product_id, sku: i.sku, name: i.name.replace(/ SET \(.*\)$/, "") }, Number(i.qty) || 1));
        setDone(true);
      }}
    >
      {done ? <><CircleCheck size={16} /> {t.inYourCart}</> : <><RotateCcw size={16} /> {t.orderAgain}</>}
    </button>
  );
}

export function AdcNotifyForm() {
  const { t } = useAdc();
  const [s, act] = useActionState(adcNotifyMe, null);
  if (s?.ok) return <div className="adc-ok" role="status"><CircleCheck size={18} aria-hidden="true" /> {s.ok}</div>;
  return (
    <form action={act} className="adc-notify">
      <input name="email" type="email" required placeholder={t.email} aria-label={t.email} autoComplete="email" />
      <input name="website" tabIndex={-1} autoComplete="off" className="adc-hp" aria-hidden="true" />
      <Go>{t.notifyBtn}</Go>
      {s?.error ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {s.error}</div> : null}
    </form>
  );
}

export function AdcAccountLink() {
  const { t } = useAdc();
  return <Link href="/adc/account" className="adc-acct" aria-label={t.account}><span>{t.account}</span></Link>;
}
