"use client";

import { useActionState } from "react";
import { updateProfile } from "@/app/(app)/profile/actions";
import { FormMessage, Submit } from "@/components/forms";
import type { FormState } from "@/app/(auth)/actions";
import type { Branch, Profile } from "@/lib/types";

export function ProfileForm({ profile, branches, employee }: { profile: Profile; branches: Pick<Branch, "id" | "name" | "state">[]; employee: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(updateProfile, null);
  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      <label className="field">
        <span className="label">Name</span>
        <input className="input" name="full_name" defaultValue={profile.full_name ?? ""} autoComplete="name" />
      </label>
      <div className="grid2">
        <label className="field">
          <span className="label">Phone</span>
          <input className="input" name="phone" type="tel" defaultValue={profile.phone ?? ""} autoComplete="tel" />
        </label>
        <label className="field">
          <span className="label">{employee ? "Your branch" : "Nearest branch"}</span>
          <select className="select" name="branch_id" defaultValue={profile.branch_id ?? ""}>
            <option value="">-</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}, {b.state}</option>)}
          </select>
        </label>
      </div>
      {employee ? (
        <label className="field">
          <span className="label">Job title</span>
          <input className="input" name="title" defaultValue={profile.title ?? ""} placeholder="e.g. Technical Sales Rep" />
        </label>
      ) : (
        <input type="hidden" name="title" value={profile.title ?? ""} />
      )}
      <FormMessage state={state} />
      <Submit className="btn dark block" pendingText="Saving…">Save changes</Submit>
    </form>
  );
}
