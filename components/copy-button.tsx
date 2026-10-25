"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A small Copy button for a value someone has to paste somewhere else. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button type="button" className="btn sm dark" onClick={copy} style={{ flex: "none", height: 34, letterSpacing: "0.04em" }}>
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? "Copied" : label}
    </button>
  );
}
