"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, FileUp, LoaderCircle } from "lucide-react";
import { loadCalls, type CallLoadRow } from "@/app/(app)/sales/actions";
import type { CallList } from "@/lib/calls-shared";

// Admins: load the reviewed call lists workbook ("AMBIT Call Lists - for review.xlsx").
// Every tab named "<Rep> - Win-back" or "<Rep> - Cold leads" becomes that rep's list. Edit the file in Excel first if you
// want (delete rows, move rows between tabs); the Summary and Removed tabs are ignored.

type Rep = { id: string; name: string };
type Part = { sheet: string; list: CallList; who: string; rep: string; rows: Omit<CallLoadRow, "rep_id">[] };
const cell = (c: unknown) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());
const ALIAS: Record<string, string[]> = { manny: ["manuel"], manuel: ["manny"] };

function matchRep(label: string, reps: Rep[]): string {
  const t = label.toLowerCase().trim();
  const exact = reps.find((r) => r.name.toLowerCase() === t);
  if (exact) return exact.id;
  const words = t.split(/\s+/);
  const last = words.length > 1 ? words[words.length - 1] : "";
  if (last) {
    const byLast = reps.filter((r) => r.name.toLowerCase().split(/\s+/).pop() === last);
    if (byLast.length === 1) return byLast[0].id;
  }
  const first = words[0];
  const firsts = [first, ...(ALIAS[first] ?? [])];
  const byFirst = reps.filter((r) => firsts.includes(r.name.toLowerCase().split(/\s+/)[0]));
  return byFirst.length === 1 ? byFirst[0].id : "";
}

function readTab(sheet: string, data: unknown[][], reps: Rep[]): Part | null {
  const m = /^(.+?)\s*-\s*(win-?back|cold leads?)$/i.exec(sheet.trim());
  if (!m) return null;
  const list: CallList = /win/i.test(m[2]) ? "winback" : "cold";
  const grid = data.map((r) => r.map(cell));
  const head = grid.findIndex((r) => r.some((c) => /^(customer|business)$/i.test(c)));
  if (head < 0) return null;
  const H = grid[head].map((h) => h.toLowerCase());
  const col = (...names: string[]) => H.findIndex((h) => names.includes(h));
  const title = grid[0]?.[0] ?? "";
  const who = /^(.+?)\s+-\s+/.exec(title)?.[1] ?? m[1];
  const g = (r: string[], i: number) => (i >= 0 ? r[i] ?? "" : "");
  const rows: Omit<CallLoadRow, "rep_id">[] = [];
  for (const r of grid.slice(head + 1)) {
    if (list === "winback") {
      const name = g(r, col("customer"));
      if (!name || /sample - not a real customer/i.test(name)) continue;
      const cs = g(r, col("city, state"));
      const linked = g(r, col("linked a.i. account"));
      const sales = Number(g(r, col("sales last 12 mo", "sales last 12 mo ($)")).replace(/[^\d.-]/g, ""));
      rows.push({
        list, name, priority: g(r, col("priority")), contact_name: g(r, col("contact", "contact name")), phone: g(r, col("phone")), email: g(r, col("email")),
        city: cs.includes(",") ? cs.slice(0, cs.lastIndexOf(",")).trim() : cs, state: cs.includes(",") ? cs.slice(cs.lastIndexOf(",") + 1).trim().slice(0, 2) : "",
        last_invoice: /^\d{4}-\d{2}-\d{2}/.test(g(r, col("last invoice"))) ? g(r, col("last invoice")).slice(0, 10) : usDate(g(r, col("last invoice"))),
        sales_12mo: Number.isFinite(sales) ? sales : null, prev_rep: g(r, col("previous rep")),
        company_name: linked && !/not found/i.test(linked) ? linked : name, sheet_note: g(r, col("notes", "account flags")), source: "Win-back sheet",
      });
    } else {
      const name = g(r, col("business"));
      if (!name) continue;
      rows.push({
        list, name, kind_guess: g(r, col("looks like")), phone: g(r, col("phone")), email: g(r, col("email")), street: g(r, col("street")),
        city: g(r, col("city")), state: g(r, col("state")), zip: g(r, col("zip")), source: g(r, col("source")), sheet_note: g(r, col("note")),
      });
    }
  }
  return { sheet, list, who, rep: matchRep(who, reps), rows };
}
function usDate(s: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}

export function CallLoader({ reps }: { reps: Rep[] }) {
  const router = useRouter();
  const [file, setFile] = useState("");
  const [parts, setParts] = useState<Part[] | null>(null);
  const [batch, setBatch] = useState(() => `Call lists ${new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function read(f: File) {
    setMsg(null); setParts(null); setFile(f.name);
    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = (await readXlsxFile(f)) as unknown as { sheet: string; data: unknown[][] }[];
      const got = sheets.map((s) => readTab(s.sheet, s.data, reps)).filter(Boolean) as Part[];
      if (!got.length) return setMsg({ ok: false, text: "No tabs named like \"Carl - Win-back\" or \"Carl - Cold leads\" in that file. Pick the reviewed call lists workbook." });
      setParts(got);
    } catch (e) {
      setMsg({ ok: false, text: `Couldn't read that file: ${(e as Error).message}` });
    }
  }
  async function load() {
    if (!parts) return;
    setBusy(true); setMsg(null);
    const rows: CallLoadRow[] = parts.flatMap((p) => p.rows.map((r) => ({ ...r, rep_id: p.rep })));
    const r = await loadCalls(rows, batch);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `Loaded ${r.added.toLocaleString()} call${r.added === 1 ? "" : "s"}.${r.skipped ? ` ${r.skipped.toLocaleString()} were already on a list (or had no name) and were skipped.` : ""} Each rep sees theirs under Sales › My calls.` });
    setParts(null); setFile("");
    router.refresh();
  }
  const missing = parts?.some((p) => !p.rep && p.rows.length);
  return (
    <section className="card2 col" aria-label="Load the lists" style={{ gap: 12, padding: 18 }}>
      <b style={{ fontSize: 16 }}>Load the call lists</b>
      <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Open the reviewed workbook in Excel and make any changes (delete rows, move a row to another rep&apos;s tab). Save it.</li>
        <li>Pick it here. Each &quot;Name - Win-back&quot; and &quot;Name - Cold leads&quot; tab goes to that rep. Nothing is loaded until you press Load.</li>
        <li>Loading the same file again adds nothing twice, so it&apos;s safe to add more rows later.</li>
      </ol>
      <label className="b2 quiet sm" style={{ alignSelf: "flex-start" }}>
        <FileUp size={15} aria-hidden /> {file ? `Picked ${file}` : "Pick the call lists workbook"}
        <input type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {parts ? (
        <>
          <div className="tbl-wrap"><table className="tbl crm-tbl">
            <thead><tr><th>Tab</th><th>List</th><th className="num">Rows</th><th>Goes to</th></tr></thead>
            <tbody>
              {parts.map((p, i) => (
                <tr key={p.sheet}>
                  <td className="small"><b>{p.sheet}</b></td>
                  <td>{p.list === "winback" ? <span className="pill red">Win-back</span> : <span className="pill info">Cold leads</span>}</td>
                  <td className="num"><b>{p.rows.length.toLocaleString()}</b></td>
                  <td>
                    <select className="select sm" value={p.rep} aria-label={`Rep for ${p.sheet}`} style={{ width: 200 }} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, rep: e.target.value } : x)))}>
                      <option value="">Pick the rep…</option>
                      {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              <tr><td colSpan={2} className="small"><b>Total</b></td><td className="num"><b>{parts.reduce((s, p) => s + p.rows.length, 0).toLocaleString()}</b></td><td /></tr>
            </tbody>
          </table></div>
          <label className="field" style={{ maxWidth: 320 }}>
            <span className="label">Name for this batch</span>
            <input className="input sm" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </label>
          {missing ? <span className="small warn-text">Pick a rep for every tab first.</span> : null}
          <button type="button" className="b2" style={{ alignSelf: "flex-start" }} disabled={busy || !!missing} onClick={load}>
            {busy ? <LoaderCircle size={16} className="spin" /> : null} {busy ? "Loading…" : `Load ${parts.reduce((s, p) => s + p.rows.length, 0).toLocaleString()} calls into the CRMs`}
          </button>
        </>
      ) : null}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"} small`} role="status">{msg.ok ? <CircleCheck size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}<span>{msg.text}</span></div> : null}
    </section>
  );
}
