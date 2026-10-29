"use client";

import { useActionState, useState } from "react";
import { UserPlus } from "lucide-react";
import { Submit } from "@/components/forms";
import { InviteShare } from "@/components/invite-form";
import type { InviteResult } from "@/lib/invites";
import { inviteMember } from "../actions";

export function InviteMember({ roles, locations }: { roles: { key: string; label: string; hint: string }[]; locations: { id: string; name: string }[] }) {
  const [state, action] = useActionState<InviteResult, FormData>(inviteMember, null);
  const [role, setRole] = useState("crew");
  const [dismissed, setDismissed] = useState<InviteResult>(null);
  if (state?.ok && state !== dismissed) {
    return (
      <div className="col" style={{ gap: 12 }}>
        <div className="alert ok small" role="status">
          <span>{state.existing ? <><b>{state.name || state.email}</b> already had a login and is on your team now.</> : <>Invite ready for <b>{state.name || state.email}</b>.</>}</span>
        </div>
        <InviteShare r={state} compact />
        <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setDismissed(state)}>
          <UserPlus size={15} /> Invite someone else
        </button>
      </div>
    );
  }
  return (
    <form key={dismissed ? "again" : "first"} action={action} className="col" style={{ gap: 10 }}>
      <div className="grid2">
        <label className="field">
          <span className="label">Email</span>
          <input className="input" name="email" type="email" required autoComplete="off" placeholder="name@email.com" />
        </label>
        <label className="field">
          <span className="label">Name</span>
          <input className="input" name="full_name" autoComplete="off" placeholder="Their name" />
        </label>
        <label className="field">
          <span className="label">Cell</span>
          <input className="input" name="phone" inputMode="tel" autoComplete="off" placeholder="To text them the link" />
        </label>
        <label className="field">
          <span className="label">Role</span>
          <select className="select" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        {locations.length > 1 ? (
          <label className="field">
            <span className="label">Location</span>
            <select className="select" name="location_id" defaultValue="">
              <option value="">Any location</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <span className="tiny faint">{roles.find((r) => r.key === role)?.hint}</span>
      {state && !state.ok ? <div className="alert err small" role="alert">{state.error}</div> : null}
      <Submit className="btn" pendingText="Inviting…"><UserPlus size={16} /> Send invite</Submit>
    </form>
  );
}
