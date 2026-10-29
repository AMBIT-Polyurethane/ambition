import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CircleAlert, CircleCheck, Download, Ruler } from "lucide-react";
import { requireTakeoff } from "@/lib/takeoff/access";
import { Submit } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { dateShort } from "@/lib/format";
import { loadReport } from "@/lib/takeoff/load";
import { STATUS_TEXT, assembly, feetInches, isFoam, num, pitchFactor } from "@/lib/takeoff/calc";
import { deleteTakeoff, updateTakeoff } from "../../actions";

export const metadata = { title: "Takeoff report" };
export const dynamic = "force-dynamic";

export default async function TakeoffReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, profile } = await requireTakeoff();
  const r = await loadReport(supabase, id);
  if (!r) notFound();
  const { t, items, totals, bySheet, materials, sheets } = r;
  const st = STATUS_TEXT[t.status] ?? STATUS_TEXT.in_progress;
  const ocBf = items.filter((i) => i.material === "open_cell").reduce((a, i) => a + (totals.get(i.id)?.bf ?? 0), 0);
  const ccBf = items.filter((i) => i.material === "closed_cell").reduce((a, i) => a + (totals.get(i.id)?.bf ?? 0), 0);
  const otherSqft = items.filter((i) => !isFoam(i.material) && i.kind !== "count").reduce((a, i) => a + (totals.get(i.id)?.sqft ?? 0), 0);
  const counts = items.filter((i) => i.kind === "count").reduce((a, i) => a + (totals.get(i.id)?.count ?? 0), 0);
  const unscaledSheets = sheets.filter((s) => !s.ft_per_pt && r.marks.some((m) => m.sheet_id === s.id));
  const howMeasured = (id: string) => {
    const it = items.find((x) => x.id === id)!;
    const tot = totals.get(id)!;
    if (it.kind === "count") return "Count";
    if (it.kind === "linear") {
      const base = `${num(tot.lf ?? 0, 1)} ft`;
      if (!it.height_ft) return `Length: ${base}`;
      return `${base} × ${feetInches(Number(it.height_ft))}${it.deduct_sqft ? ` − ${num(it.deduct_sqft)} sq ft openings` : ""}`;
    }
    return it.pitch ? `Area × ${num(pitchFactor(it.pitch), 3)} (${num(Number(it.pitch), 1)}/12 pitch)` : "Area";
  };
  const qty = (id: string) => {
    const it = items.find((x) => x.id === id)!;
    const tot = totals.get(id)!;
    if (it.kind === "count") return `${num(tot.count ?? 0)} each`;
    if (tot.sqft !== null) return `${num(tot.sqft)} sq ft`;
    return `${num(tot.lf ?? 0, 1)} ft`;
  };
  const sheetsFor = (itemId: string) => [...new Set(r.marks.filter((m) => m.item_id === itemId).map((m) => sheets.find((s) => s.id === m.sheet_id)?.name ?? ""))].filter(Boolean).join(", ");

  return (
    <main className="shell wide to-report">
      <div className="row no-print" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link href={`/takeoff/${t.id}`} className="btn sm dark"><ChevronLeft size={16} /> Back to the plan</Link>
        <span className="grow" />
        <PrintButton label="Print / save PDF" />
        <a href={`/takeoff/${t.id}/report/csv`} className="btn sm dark"><Download size={16} /> Excel</a>
      </div>
      {sp.msg ? <div className="alert ok no-print" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err no-print" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <article className="paper">
        <header className="paper-head">
          <div className="col tight">
            <div className="paper-brand">AMBIT <span>INTELLIGENCE</span> <i>TAKEOFF</i></div>
            <h1>{t.name}</h1>
            <div className="paper-sub">{[t.address, t.customer ? `for ${t.customer}` : ""].filter(Boolean).join(" · ") || " "}</div>
          </div>
          <dl className="paper-kv">
            <dt>Status</dt><dd>{st.label}</dd>
            {t.due_date ? (<><dt>Bid due</dt><dd>{dateShort(t.due_date)}</dd></>) : null}
            <dt>Plans</dt><dd>{sheets.length} sheet{sheets.length === 1 ? "" : "s"}</dd>
            <dt>Measured by</dt><dd>{t.created_by_name || profile.full_name || "AMBIT"}</dd>
            <dt>Date</dt><dd>{dateShort(t.updated_at)}</dd>
          </dl>
        </header>

        <div className="paper-tiles">
          <div><span>Open-cell spray foam</span><b>{num(ocBf)}</b><span>board feet</span></div>
          <div><span>Closed-cell spray foam</span><b>{num(ccBf)}</b><span>board feet</span></div>
          <div><span>Other insulation</span><b>{num(otherSqft)}</b><span>square feet</span></div>
          <div><span>Counted items</span><b>{num(counts)}</b><span>each</span></div>
        </div>

        {unscaledSheets.length ? (
          <p className="paper-warn">Shapes on {unscaledSheets.length} sheet{unscaledSheets.length === 1 ? "" : "s"} without a scale aren&apos;t in these numbers: {unscaledSheets.map((s) => s.name).join(", ")}.</p>
        ) : null}

        <h2>Measured items</h2>
        {items.length === 0 ? (
          <p className="paper-sub">Nothing measured yet.</p>
        ) : (
          <div className="paper-table-wrap">
            <table className="paper-table">
              <thead>
                <tr><th>Item</th><th>Assembly</th><th>How measured</th><th>Sheets</th><th className="r">Quantity</th><th className="r">Board ft</th></tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const tot = totals.get(it.id)!;
                  return (
                    <tr key={it.id}>
                      <td className="strong"><span className="sw" style={{ background: it.color }} />{it.name}</td>
                      <td>{assembly(it) || "–"}</td>
                      <td className="muted">{howMeasured(it.id)}</td>
                      <td className="muted">{sheetsFor(it.id) || "–"}</td>
                      <td className="r strong">{qty(it.id)}</td>
                      <td className="r">{tot.bf !== null ? num(tot.bf) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {materials.length ? (
          <>
            <h2>By material</h2>
            <div className="paper-table-wrap">
              <table className="paper-table">
                <thead><tr><th>Material</th><th>Thickness</th><th>Used on</th><th className="r">Area</th><th className="r">Board ft</th></tr></thead>
                <tbody>
                  {materials.map((m) => (
                    <tr key={`${m.label}-${m.thickness}`}>
                      <td className="strong">{m.label}</td>
                      <td>{m.thickness ? `${num(m.thickness, 2)}"` : "–"}</td>
                      <td className="muted">{m.items.join(", ")}</td>
                      <td className="r">{num(m.sqft)} sq ft</td>
                      <td className="r strong">{m.bf !== null ? num(m.bf) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {bySheet.length ? (
          <>
            <h2>By sheet</h2>
            <div className="paper-sheets">
              {bySheet.map(({ sheet, rows }) => (
                <div key={sheet.id} className="paper-sheet">
                  <b>{sheet.name || `Page ${sheet.page}`}</b>
                  <span className="muted small">{sheet.scale_label || (sheet.ft_per_pt ? "Scale set" : "No scale")}</span>
                  <ul>
                    {rows.map(({ item, t: tot }) => (
                      <li key={item.id}>
                        <span><span className="sw" style={{ background: item.color }} />{item.name}</span>
                        <b>{item.kind === "count" ? `${num(tot.count ?? 0)} each` : tot.sqft !== null ? `${num(tot.sqft)} sq ft` : tot.lf !== null ? `${num(tot.lf, 1)} ft` : "no scale"}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {t.notes ? (
          <>
            <h2>Notes</h2>
            <p className="paper-notes">{t.notes}</p>
          </>
        ) : null}
        <p className="paper-foot">Measured areas, lengths and counts from the plans. Waste and overspray are not included. AMBIT Polyurethane · AMBIT Intelligence.</p>
      </article>

      <details className="card no-print">
        <summary style={{ cursor: "pointer", fontWeight: 800 }}><Ruler size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Job details and notes</summary>
        <form action={updateTakeoff} className="to-new-form">
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="back" value={`/takeoff/${t.id}/report`} />
          <label className="field"><span className="label">Project or job name</span><input className="input" name="name" defaultValue={t.name} required maxLength={120} /></label>
          <label className="field"><span className="label">Customer</span><input className="input" name="customer" defaultValue={t.customer ?? ""} maxLength={120} /></label>
          <label className="field"><span className="label">Job address</span><input className="input" name="address" defaultValue={t.address ?? ""} maxLength={240} /></label>
          <label className="field"><span className="label">Bid due</span><input className="input" type="date" name="due" defaultValue={t.due_date ?? ""} /></label>
          <label className="field">
            <span className="label">Status</span>
            <select className="select" name="status" defaultValue={t.status}>
              {Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span className="label">Notes (printed on the report)</span><textarea className="textarea" name="notes" defaultValue={t.notes ?? ""} rows={3} maxLength={2000} placeholder="Assumptions, things to check, what's not included" /></label>
          <Submit className="btn sm">Save</Submit>
        </form>
        <form action={deleteTakeoff} className="row" style={{ gap: 10, marginTop: 18, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <input type="hidden" name="id" value={t.id} />
          <label className="check"><input type="checkbox" name="confirm" value="yes" required /> Delete this takeoff, its plans and everything measured</label>
          <Submit className="btn sm danger" pendingText="Deleting…">Delete takeoff</Submit>
        </form>
      </details>
    </main>
  );
}
