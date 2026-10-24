"use client";

import { useActionState } from "react";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { sendReport, type SendState } from "@/app/(app)/expenses/actions";
import { Submit } from "@/components/forms";

export function ReportSend({ month, disabled, again }: { month: string; disabled: boolean; again: boolean }) {
  const [state, action] = useActionState<SendState, FormData>(sendReport, null);
  return (
    <>
      <form action={action}>
        <input type="hidden" name="month" value={month} />
        {disabled ? (
          <button type="button" className="btn sm" disabled><Send size={15} /> Send to Corporate</button>
        ) : (
          <Submit className="btn sm" pendingText="Making the report…"><Send size={15} /> {again ? "Send again" : "Send to Corporate"}</Submit>
        )}
      </form>
      {state?.ok ? <div className="alert ok small" role="status" style={{ margin: 0, flexBasis: "100%" }}><CircleCheck size={17} style={{ flex: "none", marginTop: 1 }} /><span>{state.ok}</span></div> : null}
      {state?.warn ? <div className="alert warn small" role="status" style={{ margin: 0, flexBasis: "100%" }}><span>{state.warn}</span></div> : null}
      {state?.error ? <div className="alert err small" role="alert" style={{ margin: 0, flexBasis: "100%" }}><CircleAlert size={17} style={{ flex: "none", marginTop: 1 }} /><span>{state.error}</span></div> : null}
    </>
  );
}
