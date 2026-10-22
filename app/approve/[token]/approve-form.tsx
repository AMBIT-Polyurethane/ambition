"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { approveByLink, requestChangesByLink } from "@/app/approve/actions";

export function ApproveForm({ token, defaultName, rep }: { token: string; defaultName: string; rep: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        router.refresh();
        window.scrollTo(0, 0);
      } else setError(res.error);
    });
  };

  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="h2">Approve this order</div>
      <label className="field">
        <span className="label">Your name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="First and last name" />
      </label>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        I checked the items, quantities and delivery details.
      </label>
      {error ? (
        <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div>
      ) : null}
      <button type="button" className="btn block" disabled={pending || !checked || name.trim().length < 2} onClick={() => run(() => approveByLink(token, name))}>
        {pending ? "One moment…" : "Approve order"}
      </button>

      <details>
        <summary className="linkbtn">Something not right? Request changes</summary>
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to change? Quantities, items, delivery date…" />
          <button type="button" className="btn dark sm" disabled={pending || note.trim().length < 3} onClick={() => run(() => requestChangesByLink(token, note))}>
            Send to {rep}
          </button>
        </div>
      </details>
    </section>
  );
}
