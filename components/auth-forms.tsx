"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword, requestAccess, signIn, updatePassword, type FormState } from "@/app/(auth)/actions";
import { FormMessage, Submit } from "@/components/forms";
import type { Branch } from "@/lib/types";

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(signIn, null);
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span className="label">Email</span>
        <input className="input" type="email" name="email" autoComplete="email" placeholder="you@company.com" required />
      </label>
      <label className="field">
        <span className="label">Password</span>
        <input className="input" type="password" name="password" autoComplete="current-password" placeholder="Password" required />
      </label>
      <FormMessage state={state} />
      <Submit pendingText="Signing in…">Sign in</Submit>
      <Link href="/forgot" className="center small muted">Forgot password?</Link>
    </form>
  );
}

export function RequestAccessForm({ branches }: { branches: Pick<Branch, "id" | "name" | "state">[] }) {
  const [state, action] = useActionState<FormState, FormData>(requestAccess, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <label className="field">
        <span className="label">Your name</span>
        <input className="input" name="full_name" autoComplete="name" required />
      </label>
      <label className="field">
        <span className="label">Company</span>
        <input className="input" name="company" autoComplete="organization" required />
      </label>
      <div className="grid2">
        <label className="field">
          <span className="label">AMBIT account #</span>
          <input className="input" name="account_no" placeholder="If you know it" />
        </label>
        <label className="field">
          <span className="label">Phone</span>
          <input className="input" name="phone" type="tel" autoComplete="tel" required />
        </label>
      </div>
      <label className="field">
        <span className="label">Nearest AMBIT branch</span>
        <select className="select" name="branch_id" defaultValue="">
          <option value="">Choose one</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}, {b.state}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Email</span>
        <input className="input" type="email" name="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span className="label">Create a password</span>
        <input className="input" type="password" name="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required />
      </label>
      <FormMessage state={state} />
      <Submit pendingText="Sending…">Request access</Submit>
    </form>
  );
}

export function ForgotForm() {
  const [state, action] = useActionState<FormState, FormData>(forgotPassword, null);
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <label className="field">
        <span className="label">Email</span>
        <input className="input" type="email" name="email" autoComplete="email" required />
      </label>
      <FormMessage state={state} />
      <Submit pendingText="Sending…">Send reset link</Submit>
    </form>
  );
}

export function ResetForm() {
  const [state, action] = useActionState<FormState, FormData>(updatePassword, null);
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <label className="field">
        <span className="label">New password</span>
        <input className="input" type="password" name="password" autoComplete="new-password" minLength={8} required />
      </label>
      <label className="field">
        <span className="label">Type it again</span>
        <input className="input" type="password" name="confirm" autoComplete="new-password" minLength={8} required />
      </label>
      <FormMessage state={state} />
      <Submit pendingText="Saving…">Save password</Submit>
    </form>
  );
}
