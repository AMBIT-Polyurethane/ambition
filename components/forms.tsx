"use client";

import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck } from "lucide-react";

export function Submit({ children, className = "btn block", pendingText = "One moment…" }: {
  children: React.ReactNode; className?: string; pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

/** A submit button that asks first (for things that can't be undone). */
export function ConfirmSubmit({ children, className = "btn", pendingText = "One moment…", confirm }: {
  children: React.ReactNode; className?: string; pendingText?: string; confirm: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} onClick={(e) => { if (!window.confirm(confirm)) e.preventDefault(); }}>
      {pending ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state }: { state: { error?: string; ok?: string } | null }) {
  if (!state) return null;
  if (state.error) {
    return (
      <div className="alert err" role="alert">
        <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
        <span>{state.error}</span>
      </div>
    );
  }
  if (state.ok) {
    return (
      <div className="alert ok" role="status">
        <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
        <span>{state.ok}</span>
      </div>
    );
  }
  return null;
}
