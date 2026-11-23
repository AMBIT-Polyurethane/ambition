"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, FileSpreadsheet, LoaderCircle, Search } from "lucide-react";
import { importMatch, importRun } from "@/app/(app)/prices/actions";

export type ImportRow = {
  id: number; source: string; raw_name: string; name: string; state: string | null; rep: string | null;
  hfo: number | null; seal: number | null; jack: number | null; roof: number | null; eff_on: string | null; notes: string | null;
  company_id: string | null; matched_by: string | null; skip: boolean; imported_at: string | null;
  company: { name: string; state: string | null } | null;
};
type Tab = "todo" | "matched" | "imported" | "skipped";

const lb = (v: number | null) => (v === null ? "–" : `$${Number(v).toFixed(2)}`);

/**
 * Each row of the foam price sheet, matched to a customer. Rows the update couldn't match clearly wait in "To match":
 * type the customer, or skip the row. Import sets every matched customer's foam $/lb (and its locations') and their notes.
 */
export function PriceImport({ rows, customers }: { rows: ImportRow[]; customers: { id: string; label: string }[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(rows.some((r) => !r.company_id && !r.skip && !r.imported_at) ? "todo" : "matched");
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, go] = useTransition();
  const byLabel = useMemo(() => new Map(customers.map((c) => [c.label.toLowerCase(), c.id])), [customers]);
  const groups: Record<Tab, ImportRow[]> = {
    todo: rows.filter((r) => !r.company_id && !r.skip && !r.imported_at),
    matched: rows.filter((r) => r.company_id && !r.skip && !r.imported_at),
    imported: rows.filter((r) => r.imported_at),
    skipped: rows.filter((r) => r.skip && !r.imported_at),
  };
  const t = q.trim().toLowerCase();
  const shown = groups[tab].filter((r) => !t || `${r.raw_name} ${r.company?.name ?? ""}`.toLowerCase().includes(t));

  const match = (r: ImportRow, label: string) => {
    setTyped((m) => ({ ...m, [r.id]: label }));
    const id = byLabel.get(label.trim().toLowerCase());
    if (!id) return;
    go(async () => {
      const x = await importMatch(r.id, id);
      if (!x.ok) return setMsg({ ok: false, text: x.error });
      setTyped((m) => { const n = { ...m }; delete n[r.id]; return n; });
      router.refresh();
    });
  };
  const act = (r: ImportRow, company: string | null, skip: boolean) => go(async () => {
    const x = await importMatch(r.id, company, skip);
    if (!x.ok) return setMsg({ ok: false, text: x.error });
    router.refresh();
  });
  const run = () => {
    if (!confirm) return setConfirm(true);
    go(async () => {
      const x = await importRun();
      setConfirm(false);
      if (!x.ok) return setMsg({ ok: false, text: x.error });
      setMsg({ ok: true, text: `Imported ${x.rows} rows: ${x.prices.toLocaleString()} foam prices set (customers and their locations). Their notes are on each customer's price page.` });
      setTab("imported");
      router.refresh();
    });
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>
        The foam price spreadsheet, one row per customer. <b>Check the matches</b>, match the rest by typing the customer, then <b>Import</b>. Import sets each customer&apos;s $/lb for AMBI-TITE 204 HFO (summer and winter), AMBI-SEAL 5.0 (summer and winter), AMBI-JACK and AMBI-ROOF, also on their locations, and puts the sheet&apos;s notes on their price page. The old W&amp;SW and 1,000 lb columns are left out. Distributor prices (the newer sheet) win.
      </p>
      <datalist id="pi-customers">{customers.map((c) => <option key={c.id} value={c.label} />)}</datalist>
      <div className="row wrap between" style={{ gap: 8 }}>
        <div className="chips wrap">
          {([["todo", "To match"], ["matched", "Matched, ready"], ["imported", "Imported"], ["skipped", "Skipped"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" className={`chip sm${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l} · {groups[k].length}</button>
          ))}
        </div>
        <button type="button" className="btn sm" disabled={pending || !groups.matched.length} onClick={run}>
          {pending && confirm ? <LoaderCircle size={15} className="spin" /> : <FileSpreadsheet size={15} />}
          {confirm ? `Yes, import ${groups.matched.length} customers' prices` : `Import ${groups.matched.length} matched`}
        </button>
      </div>
      {confirm ? <div className="alert warn small"><CircleAlert size={16} /><span>This replaces these customers&apos; foam prices with the sheet&apos;s. Rows still to match are left for later.</span><button type="button" className="linkbtn small" onClick={() => setConfirm(false)}>Not yet</button></div> : null}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.ok ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<span>{msg.text}</span></div> : null}
      <div className="search"><Search size={17} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a row or customer" aria-label="Find a row" /></div>
      <div className="cr-wrap">
        <table className="cr-table">
          <thead><tr><th>On the sheet</th><th>HFO</th><th>5.0</th><th>JACK</th><th>ROOF</th><th>Customer in AMBIT Intelligence</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ maxWidth: 360 }}>
                  <b className="small">{r.raw_name}</b>
                  <div className="tiny faint">{[r.state, r.rep, r.source.startsWith("Distributor") ? "Distributor sheet" : null, r.eff_on ? `eff ${r.eff_on}` : null].filter(Boolean).join(" · ")}</div>
                  {r.notes ? <div className="tiny faint" style={{ marginTop: 2, overflowWrap: "anywhere" }} title={r.notes}>{r.notes.length > 140 ? `${r.notes.slice(0, 140)}…` : r.notes}</div> : null}
                </td>
                <td>{lb(r.hfo)}</td><td>{lb(r.seal)}</td><td>{lb(r.jack)}</td><td>{lb(r.roof)}</td>
                <td style={{ minWidth: 260 }}>
                  {r.company_id && r.company ? (
                    <span className="small"><b>{r.company.name}</b>{r.company.state ? ` (${r.company.state})` : ""}<div className="tiny faint">Matched: {r.matched_by ?? "by hand"}</div></span>
                  ) : null}
                  {!r.imported_at && (!r.company_id || tab === "matched") ? (
                    <input className="input sm" list="pi-customers" value={typed[r.id] ?? ""} placeholder={r.company_id ? "Change to…" : "Type the customer"} aria-label={`Customer for ${r.raw_name}`}
                      onChange={(e) => match(r, e.target.value)} style={{ marginTop: r.company_id ? 6 : 0 }} />
                  ) : null}
                </td>
                <td className="small">
                  {r.imported_at ? <span className="pill ok">Imported</span> : r.skip ? (
                    <button type="button" className="linkbtn small" onClick={() => act(r, r.company_id, false)}>Don&apos;t skip</button>
                  ) : (
                    <div className="col" style={{ gap: 4 }}>
                      {r.company_id ? <button type="button" className="linkbtn small" onClick={() => act(r, null, false)}>Not this one</button> : null}
                      <button type="button" className="linkbtn small" onClick={() => act(r, r.company_id, true)}>Skip</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={7} className="small muted center">Nothing here.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
