"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, CloudDownload, LoaderCircle, RefreshCw } from "lucide-react";
import { checkCopy, copyFiles, copyForms, copySubs } from "@/app/(app)/admin/forms/archive/actions";
import type { FormCheck } from "@/lib/jotform-archive";

const KIND: Record<string, string> = { credit: "Credit application", account: "Customer account setup", prf: "Price request", other: "Form" };
const name = (u: string) => {
  try {
    return decodeURIComponent(new URL(u).pathname.split("/").pop() ?? u);
  } catch {
    return u;
  }
};

/** Admins: copy every form, submission and file out of Jotform, then check the copy against Jotform. */
export function ArchiveRunner({ initial, hasKey }: { initial: FormCheck[]; hasKey: boolean }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [failed, setFailed] = useState<{ url: string; why: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const say = (t: string) => setLog((l) => [...l.slice(-40), t]);

  async function check() {
    setBusy("Checking the copy against Jotform…");
    const r = await checkCopy();
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setRows(r.forms);
    setChecked(true);
  }

  async function run() {
    setErr(null);
    setFailed([]);
    setLog([]);
    setChecked(false);
    setBusy("Reading the list of forms…");
    const f = await copyForms();
    if (!f.ok) {
      setBusy(null);
      return setErr(f.error);
    }
    say(`Found ${f.forms.length} forms.`);
    const bad: { url: string; why: string }[] = [];
    for (const [i, form] of f.forms.entries()) {
      setBusy(`Form ${i + 1} of ${f.forms.length}: ${form.title}. Copying the submissions…`);
      const s = await copySubs(form.id);
      if (!s.ok) {
        say(`${form.title}: couldn't copy (${s.error}).`);
        continue;
      }
      let saved = 0;
      for (let j = 0; j < s.pending.length; j += 6) {
        setBusy(`Form ${i + 1} of ${f.forms.length}: ${form.title}. Saving files ${Math.min(j + 6, s.pending.length)} of ${s.pending.length}…`);
        const r = await copyFiles(form.id, s.pending.slice(j, j + 6));
        if (!r.ok) {
          bad.push(...s.pending.slice(j, j + 6).map((p) => ({ url: p.url, why: r.error })));
          continue;
        }
        saved += r.saved;
        bad.push(...r.failed);
      }
      say(`${form.title}: ${s.subs} submissions copied; ${s.files} files on them (${s.files - s.pending.length} already saved, ${saved} saved now).`);
    }
    setFailed(bad);
    await check();
  }

  const done = checked && rows.length > 0 && rows.every((r) => r.jotform !== null && r.copied >= r.jotform && r.missingSubs.length === 0 && r.missingFiles === 0);
  const apps = rows.filter((r) => r.kind === "credit" || r.kind === "account");

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={run} disabled={!!busy || !hasKey} style={{ gap: 8 }}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <CloudDownload size={16} />} {rows.length ? "Copy again (adds anything new)" : "Copy everything from Jotform"}
        </button>
        {rows.length ? (
          <button type="button" className="btn dark" onClick={check} disabled={!!busy} style={{ gap: 8 }}>
            <RefreshCw size={16} /> Check against Jotform
          </button>
        ) : null}
      </div>
      {!hasKey ? <div className="alert warn small">The Jotform key isn&apos;t in Vercel, so there&apos;s nothing to copy from. What&apos;s below is the copy A.I. already has.</div> : null}
      {busy ? <div className="alert small" role="status"><LoaderCircle size={16} className="spin" style={{ flex: "none" }} /><span>{busy} Keep this page open.</span></div> : null}
      {err ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none" }} /><span>{err}</span></div> : null}
      {checked ? (
        done ? (
          <div className="alert ok" role="status">
            <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
            <span>
              <b>Everything is copied.</b> Every submission Jotform has right now is in A.I., with all {rows.reduce((s, r) => s + r.files, 0).toLocaleString()} attached files and signatures saved. It&apos;s safe to cancel Jotform. Run this once more right before you do, in case anything new came in.
            </span>
          </div>
        ) : (
          <div className="alert warn" role="status">
            <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
            <span><b>Not finished yet.</b> Some submissions or files below aren&apos;t copied. Click <b>Copy again</b>; it only fetches what&apos;s missing. If the same ones keep failing, they&apos;re listed at the bottom.</span>
          </div>
        )
      ) : null}
      {rows.length ? (
        <div className="tbl-wrap card" style={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr><th>Form</th><th>Type</th><th className="num">In Jotform</th><th className="num">Copied</th><th className="num">Files</th><th className="num">Files saved</th><th>Status</th></tr>
            </thead>
            <tbody>
              {[...apps, ...rows.filter((r) => !apps.includes(r))].map((r) => {
                const ok = r.jotform !== null && r.copied >= r.jotform && r.missingSubs.length === 0 && r.missingFiles === 0;
                return (
                  <tr key={r.id}>
                    <td><b className="small">{r.title}</b></td>
                    <td className="small">{KIND[r.kind] ?? r.kind}</td>
                    <td className="num">{r.jotform ?? "?"}</td>
                    <td className="num">{r.copied}</td>
                    <td className="num">{r.files}</td>
                    <td className="num">{r.filesSaved}</td>
                    <td className="small">
                      {!checked ? <span className="faint">Not checked yet</span> : ok ? <span className="ok-text">✓ All copied</span> : (
                        <span className="warn-text">
                          {r.jotform === null ? "Couldn't ask Jotform" : [r.missingSubs.length || (r.jotform ?? 0) > r.copied ? `${Math.max(r.missingSubs.length, (r.jotform ?? 0) - r.copied)} submissions missing` : "", r.missingFiles ? `${r.missingFiles} files missing` : ""].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {log.length ? (
        <details className="card" style={{ padding: "10px 14px" }} open={!checked}>
          <summary className="small"><b>What it did</b></summary>
          <ul className="small muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </details>
      ) : null}
      {failed.length ? (
        <details className="card" style={{ padding: "10px 14px" }} open>
          <summary className="small warn-text"><b>{failed.length} files couldn&apos;t be saved this time</b></summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {failed.slice(0, 60).map((f, i) => <li key={i}>{name(f.url)} <span className="faint">({f.why})</span></li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
