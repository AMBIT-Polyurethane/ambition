"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { savePrfApproval, type PrfSaveState } from "@/app/(app)/price-requests/actions";

/**
 * The approver's price form on a price request. Saving shows the result right here (green when it saved
 * and emailed the rep, red otherwise) while the page refreshes underneath. No page jump.
 */
export function PrfApproveForm({ children }: { children: React.ReactNode }) {
  const [state, action] = useActionState<PrfSaveState, FormData>(savePrfApproval, null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Pick up the new status and prices in the background; the result message is already showing.
    router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="col" style={{ gap: 12 }}>
      {state ? (
        <div ref={box} className={`alert ${state.ok ? "ok" : "err"}`} role={state.ok ? "status" : "alert"}>
          {state.ok ? <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />}
          <span>{state.msg}</span>
        </div>
      ) : null}
      {children}
    </form>
  );
}
