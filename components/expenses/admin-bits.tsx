"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Landmark, LoaderCircle, Upload } from "lucide-react";
import { Submit } from "@/components/forms";
import { CATEGORIES } from "@/lib/expense-kinds";
import {
  assignCharge,
  excuseCharge,
  plaidFinish,
  plaidStart,
  reviewMonth,
  setApprovers,
  setCard,
  uploadStatement,
  type UploadState,
} from "@/app/(app)/admin/expenses/actions";

type Res = { ok: true; msg?: string } | { ok: false; error: string };
export type Person = { id: string; name: string };

function Msg({ r }: { r: Res | null }) {
  if (!r) return null;
  if (r.ok) return r.msg ? <div className="alert ok small" style={{ margin: 0 }}><CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /><span>{r.msg}</span></div> : null;
  return <div className="alert err small" style={{ margin: 0 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} /><span>{r.error}</span></div>;
}

/** A button that runs one server action (two taps when `confirm` is set). */
export function ActBtn({ action, children, className = "btn sm dark", confirm }: { action: () => Promise<Res>; children: React.ReactNode; className?: string; confirm?: string }) {
  const [r, setR] = useState<Res | null>(null);
  const [sure, setSure] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="col" style={{ gap: 8 }}>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !sure) return setSure(true);
          setSure(false);
          start(async () => {
            const x = await action();
            setR(x);
            if (x.ok) router.refresh();
          });
        }}
      >
        {pending ? <LoaderCircle size={15} className="spin" /> : null}
        {confirm && sure ? confirm : children}
      </button>
      <Msg r={r} />
    </div>
  );
}

export function UploadStatement() {
  const [state, action] = useActionState<UploadState, FormData>(uploadStatement, null);
  return (
    <form action={action} className="col" style={{ gap: 10 }}>
      <input className="input" type="file" name="file" accept=".csv,text/csv" required />
      {state?.needCard ? (
        <label className="field">
          <span className="label">Card&apos;s last 4 digits</span>
          <input className="input" name="card" inputMode="numeric" maxLength={4} placeholder="1234" style={{ maxWidth: 140 }} />
        </label>
      ) : null}
      <Submit className="btn sm" pendingText="Reading the statement…">
        <Upload size={15} /> Upload and match
      </Submit>
      {state?.ok ? <div className="alert ok small" style={{ margin: 0 }}><CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /><span>{state.ok}</span></div> : null}
      {state?.error ? <div className="alert err small" style={{ margin: 0 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} /><span>{state.error}</span></div> : null}
    </form>
  );
}

/** Whose card is this (and its name). */
export function CardRow({ last4, label, userId, people }: { last4: string; label: string | null; userId: string | null; people: Person[] }) {
  const [who, setWho] = useState(userId ?? "");
  const [name, setName] = useState(label ?? "");
  const [r, setR] = useState<Res | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = who !== (userId ?? "") || name !== (label ?? "");
  return (
    <div className="xa-card">
      <b className="xa-l4">••{last4}</b>
      <input className="input sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Card name" />
      <select className="select sm" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">Nobody yet</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn sm"
        disabled={!dirty || pending}
        onClick={() =>
          start(async () => {
            const x = await setCard(last4, who || null, name || null);
            setR(x);
            if (x.ok) router.refresh();
          })
        }
      >
        Save
      </button>
      {r ? <div style={{ gridColumn: "1 / -1" }}><Msg r={r} /></div> : null}
    </div>
  );
}

/** Add a card that hasn't shown up on a statement yet. */
export function NewCard({ people }: { people: Person[] }) {
  const [l4, setL4] = useState("");
  return l4.length === 4 ? (
    <CardRow last4={l4} label={null} userId={null} people={people} />
  ) : (
    <label className="row tiny muted" style={{ gap: 8 }}>
      Add a card: last 4
      <input className="input sm" style={{ width: 90 }} inputMode="numeric" maxLength={4} onChange={(e) => setL4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" />
    </label>
  );
}

/** A card charge with no receipt, on the approver's side: give it to someone, or "no receipt needed". */
export function ChargeTools({ chargeId, people, current }: { chargeId: string; people: Person[]; current: string | null }) {
  const [mode, setMode] = useState<null | "excuse" | "assign">(null);
  const [note, setNote] = useState("");
  const [cat, setCat] = useState("Other");
  const [who, setWho] = useState(current ?? "");
  const [r, setR] = useState<Res | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      const x = await fn();
      setR(x);
      if (x.ok) {
        setMode(null);
        router.refresh();
      }
    });
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className={`chip sm${mode === "excuse" ? " on2" : ""}`} onClick={() => setMode(mode === "excuse" ? null : "excuse")}>
          No receipt needed
        </button>
        <button type="button" className={`chip sm${mode === "assign" ? " on2" : ""}`} onClick={() => setMode(mode === "assign" ? null : "assign")}>
          {current ? "Someone else's" : "Whose is it?"}
        </button>
      </div>
      {mode === "excuse" ? (
        <div className="xa-tool">
          <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (subscription, autopay, bank fee…)" />
          <select className="select sm" value={cat} onChange={(e) => setCat(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button type="button" className="btn sm" disabled={pending || !note.trim()} onClick={() => run(() => excuseCharge(chargeId, note, cat))}>
            Save
          </button>
        </div>
      ) : null}
      {mode === "assign" ? (
        <div className="xa-tool">
          <select className="select sm" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Nobody</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button type="button" className="btn sm" disabled={pending || who === (current ?? "")} onClick={() => run(() => assignCharge(chargeId, who || null))}>
            Move it
          </button>
        </div>
      ) : null}
      <Msg r={r} />
    </div>
  );
}

export function UndoExcuse({ chargeId }: { chargeId: string }) {
  return (
    <ActBtn action={() => excuseCharge(chargeId, null, null)} className="xm-unlink">
      Undo
    </ActBtn>
  );
}

/** Approve, or send back with a note ("reopen": an approved month can still be sent back). */
export function ReviewForm({ userId, month, mode, canApprove, mine, missing }: { userId: string; month: string; mode: "review" | "reopen" | "none"; canApprove: boolean; mine: boolean; missing: number }) {
  const [note, setNote] = useState("");
  const [r, setR] = useState<Res | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (approve: boolean) =>
    start(async () => {
      const x = await reviewMonth(userId, month, approve, note);
      setR(x);
      if (x.ok) {
        setNote("");
        router.refresh();
      }
    });
  if (mode === "none" || (mine && mode === "review")) {
    return (
      <>
        {mine && mode === "review" ? <div className="alert info small" style={{ margin: 0 }}>This is your own report. Another approver approves it.</div> : null}
        <Msg r={r} />
      </>
    );
  }
  if (mode === "reopen") {
    return (
      <>
        <Msg r={r} />
        <details>
          <summary className="tiny muted" style={{ cursor: "pointer" }}>Something wrong? Send it back</summary>
          <div className="col" style={{ gap: 10, marginTop: 10 }}>
            <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs fixing" />
            <button type="button" className="btn sm dark" style={{ alignSelf: "flex-start" }} disabled={pending || !note.trim()} onClick={() => go(false)}>
              Send back
            </button>
          </div>
        </details>
      </>
    );
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      <label className="field">
        <span className="label">Note to them (needed to send it back)</span>
        <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Which customer was the Oct 14 dinner for? / Looks good." />
      </label>
      <div className="row wrap" style={{ gap: 10 }}>
        <button type="button" className="btn sm" disabled={pending || !canApprove} onClick={() => go(true)}>
          <CircleCheck size={15} /> Approve
        </button>
        <button type="button" className="btn sm dark" disabled={pending || !note.trim()} onClick={() => go(false)}>
          Send back
        </button>
        {pending ? <LoaderCircle size={16} className="spin" /> : null}
      </div>
      {!canApprove && missing ? (
        <span className="tiny muted">
          {missing} card {missing === 1 ? "charge has" : "charges have"} no receipt. Send it back, or mark {missing === 1 ? "it" : "them"} &quot;No receipt needed&quot; above.
        </span>
      ) : null}
      <Msg r={r} />
    </div>
  );
}

export function ApproversForm({ people, chosen, canEdit }: { people: (Person & { email: string })[]; chosen: string[]; canEdit: boolean }) {
  const [on, setOn] = useState(new Set(chosen));
  const [r, setR] = useState<Res | null>(null);
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const router = useRouter();
  const list = people.filter((p) => on.has(p.id) || (q && `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="list">
        {list.map((p) => (
          <label key={p.id} className="item" style={{ minHeight: 52, cursor: canEdit ? "pointer" : "default" }}>
            <input
              type="checkbox"
              checked={on.has(p.id)}
              disabled={!canEdit}
              onChange={(e) => {
                const n = new Set(on);
                if (e.target.checked) n.add(p.id);
                else n.delete(p.id);
                setOn(n);
              }}
            />
            <span className="grow col" style={{ gap: 1 }}>
              <span className="t" style={{ fontSize: 14 }}>{p.name}</span>
              <span className="s">{p.email}</span>
            </span>
          </label>
        ))}
      </div>
      {canEdit ? (
        <>
          <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add someone: type a name" />
          <button
            type="button"
            className="btn sm"
            style={{ alignSelf: "flex-start" }}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const x = await setApprovers([...on]);
                setR(x);
                if (x.ok) router.refresh();
              })
            }
          >
            Save approvers
          </button>
        </>
      ) : (
        <span className="tiny muted">An admin can change who approves.</span>
      )}
      <Msg r={r} />
    </div>
  );
}

declare global {
  interface Window {
    Plaid?: { create: (o: { token: string; onSuccess: (pt: string, meta: { institution?: { name?: string } | null }) => void; onExit: (err: unknown) => void }) => { open: () => void } };
  }
}

/** "Connect Chase": opens Plaid's window (Chase's own sign-in happens there, never in this app). */
export function PlaidConnect({ again }: { again?: boolean }) {
  const [r, setR] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (document.getElementById("plaid-link-js")) return;
    const s = document.createElement("script");
    s.id = "plaid-link-js";
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);
  const go = async () => {
    setR(null);
    setBusy(true);
    const t = await plaidStart();
    if (!t.ok) {
      setBusy(false);
      return setR(t);
    }
    if (!window.Plaid) {
      setBusy(false);
      return setR({ ok: false, error: "Plaid's window didn't load. Check your internet and try again." });
    }
    window.Plaid.create({
      token: t.token,
      onSuccess: async (pt, meta) => {
        const x = await plaidFinish(pt, meta?.institution?.name ?? null);
        setBusy(false);
        setR(x);
        if (x.ok) router.refresh();
      },
      onExit: () => setBusy(false),
    }).open();
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <button type="button" className="btn sm" onClick={go} disabled={busy} style={{ alignSelf: "flex-start" }}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <Landmark size={15} />} {again ? "Connect another account" : "Connect Chase"}
      </button>
      <Msg r={r} />
    </div>
  );
}
