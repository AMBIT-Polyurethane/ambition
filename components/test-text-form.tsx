"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { sendTestText } from "@/app/(app)/admin/texting/actions";
import { Submit } from "@/components/forms";

export function TestTextForm() {
  const [state, action] = useActionState(sendTestText, null);
  return (
    <form action={action} className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="input" name="to" type="tel" inputMode="tel" required placeholder="Your mobile" aria-label="Mobile to text" style={{ flex: "1 1 200px" }} />
        <Submit className="btn" pendingText="Sending…"><Send size={16} /> Send a test text</Submit>
      </div>
      {state ? <span className={`small ${state.ok ? "ok-text" : "err-text"}`} role={state.ok ? "status" : "alert"}>{state.msg}</span> : null}
    </form>
  );
}
