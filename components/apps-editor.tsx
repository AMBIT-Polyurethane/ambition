"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Icon } from "@/components/icons";
import { FormMessage } from "@/components/forms";
import { saveHomeApps } from "@/app/(app)/profile/actions";
import type { FormState } from "@/app/(auth)/actions";

type Row = { key: string; label: string; icon: string; color: string; hidden: boolean; folder?: string | null };

/** Profile → Your apps: reorder with the arrows, switch apps on or off, then save. */
export function AppsEditor({ apps }: { apps: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(apps);
  const [state, setState] = useState<FormState>(null);
  const [pending, start] = useTransition();

  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const toggle = (i: number) => setRows((r) => r.map((x, k) => (k === i ? { ...x, hidden: !x.hidden } : x)));

  const save = (layout: { order: string[]; hidden: string[] } | null) =>
    start(async () => {
      const res = await saveHomeApps(layout);
      setState(res);
      if (!res?.error) router.push("/");
    });

  const shown = rows.filter((r) => !r.hidden).length;
  return (
    <div className="col apps-edit" style={{ gap: 14 }}>
      <div className="list">
        {rows.map((r, i) => (
          <div key={r.key} className={`row-app${r.hidden ? " off" : ""}`}>
            <span className="app-ic" style={{ ["--c" as string]: r.color }}><Icon name={r.icon} size={20} /></span>
            <span className="name">
              {r.label}
              {r.folder ? <span className="tiny faint" style={{ display: "block", fontWeight: 600 }}>In {r.folder}</span> : null}
            </span>
            <button type="button" className="mv" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.label} up`}><ArrowUp size={16} /></button>
            <button type="button" className="mv" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${r.label} down`}><ArrowDown size={16} /></button>
            <button type="button" className="switch" role="switch" aria-checked={!r.hidden} aria-label={`Show ${r.label} on my home screen`} onClick={() => toggle(i)} />
          </div>
        ))}
      </div>
      <FormMessage state={state} />
      <button
        type="button"
        className="btn block"
        disabled={pending || shown === 0}
        onClick={() => save({ order: rows.map((r) => r.key), hidden: rows.filter((r) => r.hidden).map((r) => r.key) })}
      >
        {pending ? "Saving…" : "Save my apps"}
      </button>
      <button type="button" className="btn dark block" disabled={pending} onClick={() => save(null)}>
        Reset to the standard layout
      </button>
    </div>
  );
}
