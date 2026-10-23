"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteMyAccount } from "@/app/(app)/profile/actions";
import { FormMessage, Submit } from "@/components/forms";
import type { FormState } from "@/app/(auth)/actions";

/** "Delete my account": explains what goes and what stays, then asks for DELETE to be typed. */
export function DeleteAccount({ email }: { email: string }) {
  const [state, action] = useActionState<FormState, FormData>(deleteMyAccount, null);
  const [typed, setTyped] = useState("");
  return (
    <details className="danger-zone">
      <summary>
        <Trash2 size={16} /> Delete my account
      </summary>
      <form action={action} className="col" style={{ gap: 12, marginTop: 12 }}>
        <p className="small" style={{ margin: 0 }}>
          This permanently deletes your AMBITION login (<b>{email}</b>) and your profile: name, phone, title and settings. You&apos;ll be
          signed out and can&apos;t undo it.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Orders and requests you already sent stay on file with AMBIT for its business records. To use AMBITION again later, you&apos;d
          request access again.
        </p>
        <label className="field">
          <span className="label">Type DELETE to confirm</span>
          <input
            className="input"
            name="confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="DELETE"
          />
        </label>
        <FormMessage state={state} />
        {typed.trim().toUpperCase() === "DELETE" ? (
          <Submit className="btn block danger" pendingText="Deleting…">Delete my account</Submit>
        ) : (
          <button type="button" className="btn block danger" disabled>Delete my account</button>
        )}
      </form>
    </details>
  );
}
