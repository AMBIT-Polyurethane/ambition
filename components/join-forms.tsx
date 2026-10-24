"use client";

import Link from "next/link";
import { useActionState } from "react";
import { joinCreate, joinSignIn, type JoinState } from "@/app/(auth)/join/actions";
import { FormMessage, Submit } from "@/components/forms";

export function JoinCreateForm({ token, name, phone }: { token: string; name: string; phone: string }) {
  const [state, action] = useActionState<JoinState, FormData>(joinCreate, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <input type="hidden" name="token" value={token} />
      <label className="field">
        <span className="label">Your name</span>
        <input className="input" name="full_name" autoComplete="name" defaultValue={name} required />
      </label>
      <label className="field">
        <span className="label">Cell phone (optional)</span>
        <input className="input" name="phone" type="tel" autoComplete="tel" defaultValue={phone} />
      </label>
      <label className="field">
        <span className="label">Create a password</span>
        <input className="input" type="password" name="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required />
      </label>
      <FormMessage state={state} />
      <Submit pendingText="Setting up…">Set up my account</Submit>
    </form>
  );
}

export function JoinSignInForm({ token }: { token: string }) {
  const [state, action] = useActionState<JoinState, FormData>(joinSignIn, null);
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <input type="hidden" name="token" value={token} />
      <label className="field">
        <span className="label">Your password</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required />
      </label>
      <FormMessage state={state} />
      <Submit pendingText="Signing in…">Sign in and finish</Submit>
      <Link href="/forgot" className="center small muted">Forgot password?</Link>
    </form>
  );
}
