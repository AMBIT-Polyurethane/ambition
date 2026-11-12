"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { markWithheld } from "@/app/(app)/expenses/actions";

export function WithheldButton({ chargeId, withheld }: { chargeId: string; withheld: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <button
      type="button"
      className={`btn sm${withheld ? " dark" : ""}`}
      disabled={pending}
      title={err ?? undefined}
      onClick={() =>
        start(async () => {
          const r = await markWithheld(chargeId, !withheld);
          if (!r.ok) setErr(r.error);
          else router.refresh();
        })
      }
    >
      {pending ? <LoaderCircle size={14} className="spin" /> : withheld ? null : <CircleCheck size={14} />} {withheld ? "Undo" : "Taken out"}
    </button>
  );
}
