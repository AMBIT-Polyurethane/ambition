"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, LoaderCircle, ScanSearch } from "lucide-react";
import { checkBolBatch } from "@/app/(app)/orders/bol-review/actions";

// BOL review (0082): read every signed BOL that hasn't been read yet with AI, a few at a time, with progress.

export function BolAuditRunner({ toCheck, checked, problems }: { toCheck: number; checked: number; problems: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [left, setLeft] = useState(toCheck);
  const [cents, setCents] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    setFinished(false);
    let n = 0;
    let c = 0;
    const bad: string[] = [];
    try {
      for (let i = 0; i < 400; i++) {
        const r = await checkBolBatch();
        if (!r.ok) {
          setError(r.error);
          break;
        }
        n += r.done;
        c += r.cents;
        bad.push(...r.failed);
        setDone(n);
        setCents(c);
        setFailed([...bad]);
        setLeft(r.left);
        if (r.left === 0 || r.done + r.failed.length === 0) {
          setFinished(true);
          break;
        }
      }
    } catch {
      setError("It stopped part way (the connection dropped or a read took too long). Press it again to carry on from where it stopped.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  return (
    <section className="card col" style={{ gap: 8 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <b className="row" style={{ gap: 8 }}><ScanSearch size={18} /> AI check of every signed BOL</b>
        <span className="tiny faint">{checked} read · {problems} with problems{left ? ` · ${left} not read yet` : ""}</span>
      </div>
      <span className="small muted">
        The app reads each photo and checks it&apos;s this order&apos;s paperwork (not another order&apos;s or a photo of drums), that it&apos;s signed,
        and that the lot numbers on it match what the app recorded. New BOLs are read when the warehouse attaches them. Problems go on Admin &gt; Data check.
      </span>
      {left > 0 ? (
        <button type="button" className="btn sm dark" onClick={run} disabled={busy} style={{ alignSelf: "flex-start", gap: 8 }}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <ScanSearch size={16} />}
          {busy ? `Reading… ${done} done, ${left} to go` : `Read ${left} signed BOL${left === 1 ? "" : "s"} with AI (about $${Math.max(0.01, left * 0.02).toFixed(2)})`}
        </button>
      ) : null}
      {busy ? <span className="tiny faint">Keep this page open. It reads 4 at a time (about 20 seconds each round).</span> : null}
      {finished && !busy ? (
        <div className="alert ok small" role="status"><CircleCheck size={16} style={{ flex: "none", marginTop: 2 }} /><span>Done: read {done} order{done === 1 ? "" : "s"} (about ${(cents / 100).toFixed(2)}). The problems are below and on Admin &gt; Data check.</span></div>
      ) : null}
      {error ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{error}</span></div> : null}
      {failed.length ? <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>Couldn&apos;t read: {failed.join(" · ")}</span></div> : null}
    </section>
  );
}
