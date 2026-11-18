"use client";

import { useRef, useState } from "react";
import { Camera, LoaderCircle } from "lucide-react";
import { addOrderFiles } from "@/app/(app)/orders/actions";
import { uploadOrderFiles } from "@/lib/order-file-upload";

/** Add a photo or scan of the signed BOL / packing slip to an order. The AI checks it's this order's before it says OK. */
export function AddFiles({ orderId, kind = "bol", label = "Add signed paperwork" }: { orderId: string; kind?: "bol" | "invoice"; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "up" | "ai">(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (list: File[]) => {
    if (!list.length) return;
    setError(null);
    setBusy("up");
    const up = await uploadOrderFiles(orderId, kind, list.slice(0, 6));
    if (up.error) {
      setBusy(null);
      return setError(up.error);
    }
    setBusy("ai");
    const fd = new FormData();
    fd.append("id", orderId);
    fd.append("kind", kind);
    for (const f of up.ok) {
      fd.append("file_path", f.path);
      fd.append("file_name", f.name);
    }
    try {
      await addOrderFiles(fd);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          const l = Array.from(e.target.files ?? []);
          e.target.value = "";
          void go(l);
        }}
      />
      <button type="button" className="b2 quiet" onClick={() => ref.current?.click()} disabled={busy !== null} style={{ alignSelf: "flex-start" }}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <Camera size={17} />}
        {busy === "up" ? "Uploading…" : busy === "ai" ? "The AI is checking it…" : label}
      </button>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
    </div>
  );
}
