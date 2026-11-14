"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2, X } from "lucide-react";
import { deleteTakeoff } from "@/app/(app)/takeoff/actions";

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn sm to-del-go" disabled={pending}>{pending ? "Deleting…" : "Delete"}</button>;
}

/** The trash button on a takeoff in the list. Tap it, then confirm right there in the row. */
export function TakeoffDelete({ id, name, back }: { id: string; name: string; back: string }) {
  const [sure, setSure] = useState(false);
  if (!sure) return (
    <button type="button" className="to-del" onClick={() => setSure(true)} aria-label={`Delete ${name}`} title="Delete">
      <Trash2 size={16} />
    </button>
  );
  return (
    <form action={deleteTakeoff} className="to-del-ask" role="alertdialog" aria-label={`Delete ${name}?`}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="confirm" value="yes" />
      <input type="hidden" name="to" value={back} />
      <span className="small">Delete <b>{name}</b>, its plans and everything measured? This can&apos;t be undone.</span>
      <Go />
      <button type="button" className="btn sm dark" onClick={() => setSure(false)} autoFocus><X size={14} /> Keep it</button>
    </form>
  );
}
