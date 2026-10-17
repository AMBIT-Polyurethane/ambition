"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload } from "lucide-react";
import { DocForm } from "@/components/doc-form";
import { copyDocFile } from "@/app/(app)/admin/actions";

export function NewDoc({ families }: { families: string[] }) {
  const [key, setKey] = useState(0);
  const [last, setLast] = useState("");
  return (
    <>
      {last ? <div className={`alert small ${/wasn't copied/.test(last) ? "warn" : "ok"}`} style={{ marginBottom: 12 }}>{last}</div> : null}
      <DocForm
        key={key}
        families={families}
        onDone={(res) => {
          setLast(`Added. ${res.message.replace(/^Saved\.\s*/, "")}`.trim());
          setKey((k) => k + 1);
        }}
      />
    </>
  );
}

type Pending = { id: string; title: string };

/** Copies every linked-but-not-stored file into the app, one request per file so none time out. */
export function CopyAllDocs({ pending }: { pending: Pending[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<{ title: string; message: string }[]>([]);
  const [finished, setFinished] = useState(false);

  if (pending.length === 0 && !finished) return null;

  const run = async () => {
    setRunning(true);
    setFinished(false);
    setDone(0);
    setFailed([]);
    const queue = [...pending];
    const bad: { title: string; message: string }[] = [];
    let count = 0;
    const worker = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        let res;
        try {
          res = await copyDocFile(d.id);
        } catch {
          res = { ok: false, message: "The app didn't answer." };
        }
        if (!res.ok) bad.push({ title: d.title, message: res.message });
        count += 1;
        setDone(count);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setFailed(bad);
    setRunning(false);
    setFinished(true);
    router.refresh();
  };

  const total = finished ? done : pending.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="card col">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="grow col" style={{ gap: 4 }}>
          <b>{finished ? "Copy finished" : `${pending.length} document${pending.length === 1 ? "" : "s"} still open from the website`}</b>
          <span className="small muted">
            {finished
              ? `${done - failed.length} of ${done} copied into the app.${failed.length ? " The ones below need a look." : ""}`
              : "Copy them into the app so they keep working if the website changes. The links stay on file, so you can re-copy any time."}
          </span>
        </div>
        {!finished || failed.length ? (
          <button type="button" className="btn sm" onClick={run} disabled={running || pending.length === 0}>
            <CloudDownload size={15} /> {running ? `Copying ${done} of ${pending.length}…` : finished ? "Try again" : "Copy files into the app"}
          </button>
        ) : null}
      </div>
      {running || finished ? (
        <div style={{ height: 6, borderRadius: 3, background: "var(--s2)", overflow: "hidden" }} aria-hidden="true">
          <div style={{ width: `${finished ? 100 : pct}%`, height: "100%", background: failed.length ? "var(--warn)" : "var(--red)", transition: "width .2s" }} />
        </div>
      ) : null}
      {failed.length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {failed.map((f) => (
            <li key={f.title}><b>{f.title}</b>: <span className="muted">{f.message}</span></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
