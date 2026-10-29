"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyBox({ value, label, multiline }: { value: string; label: string; multiline?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const t = document.createElement("textarea");
      t.value = value;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <div className={multiline ? "col" : "row"} style={{ gap: 8 }}>
      {multiline ? (
        <textarea className="textarea" readOnly value={value} rows={3} onFocus={(e) => e.target.select()} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
      ) : (
        <input className="input sm grow" readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} />
      )}
      <button type="button" className="btn sm dark" onClick={copy} style={{ alignSelf: multiline ? "flex-start" : undefined }}>
        {done ? <Check size={15} /> : <Copy size={15} />} {done ? "Copied" : label}
      </button>
    </div>
  );
}
