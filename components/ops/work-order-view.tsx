import { CircleAlert } from "lucide-react";
import { TARGETS, coreDensity, fmt, imbalance, readingChecks } from "@/lib/ops/field/calc";
import { addressText, hoursByPerson, woLabel, yieldRows, type WoDetail } from "@/lib/ops/work-orders-server";

// One work order, read-only: the office review page and AMBIT tech support show the same thing.

const WHEN = [["start", "Start"], ["mid", "Midday"], ["end", "End"]] as const;
type R = Record<string, unknown>;
const obj = (v: unknown): R => (v && typeof v === "object" ? (v as R) : {});
const txt = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : v === "yes" ? "Yes" : v === "no" ? "No" : String(v));
const tz = "America/Chicago";
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }) : "–");
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "now");
const dayText = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
const hrs = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export function WorkOrderView({ d }: { d: WoDetail }) {
  const w = d.wo;
  const people = hoursByPerson(d.time);
  const ys = yieldRows(d);
  const addr = addressText(d.property);
  const totBf = d.areas.reduce((s, a) => s + (Number(a.bf) || 0), 0);
  const totSq = d.areas.reduce((s, a) => s + (Number(a.sqft) || 0), 0);
  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card col" style={{ gap: 6 }}>
        <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
          <span className="col tight" style={{ minWidth: 0 }}>
            <span className="eyebrow">{woLabel(d)} · {d.trip.name}</span>
            <b style={{ fontSize: 20 }}>{d.customer.name}</b>
            {addr ? <span className="small muted">{addr}</span> : null}
          </span>
          <span className={`pill ${w.status === "open" ? "warn" : "ok"}`}>{w.status === "open" ? "In progress" : w.status === "done" ? "Finished" : "Reviewed"}</span>
        </div>
        <span className="tiny faint">
          {dayText(d.trip.start_date)}{d.trip.days > 1 ? ` – ${dayText(d.trip.end_date)}` : ""}{d.rig ? ` · ${d.rig.name}` : ""} · Crew: {d.crew.map((c) => `${c.name}${c.lead ? " (lead)" : ""}`).join(", ") || "–"}
        </span>
        {w.finished_at ? <span className="tiny faint">Finished {when(w.finished_at)}{w.finished_by_name ? ` by ${w.finished_by_name}` : ""}</span> : null}
        {w.reviewed_at ? <span className="tiny faint">Reviewed {when(w.reviewed_at)} by {w.reviewed_by_name}{w.review_note ? `: ${w.review_note}` : ""}</span> : null}
      </section>

      {w.issue ? (
        <div className="alert warn small">
          <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />
          <span className="col tight">
            <b>Issue: {w.issue}</b>
            <span>Affected installed foam: {txt(w.issue_affected === "unsure" ? "Not sure" : w.issue_affected)} · AMBIT tech support contacted: {w.tech_contacted === null ? "–" : w.tech_contacted ? "Yes" : "No"}</span>
            {w.corrective ? <span>Corrective action: {w.corrective}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="wo-grid">
        <section className="card col" style={{ gap: 8 }}>
          <b>Time</b>
          {!people.length ? <span className="small muted">No punches.</span> : null}
          {people.map((p) => (
            <div key={p.name} className="row between small"><span>{p.name}{p.open ? " · still on the clock" : ""}</span><span>{hrs(p.site)} on site{p.drive ? ` · ${hrs(p.drive)} driving` : ""}</span></div>
          ))}
          {d.time.length ? (
            <details>
              <summary className="tiny faint">Every punch ({d.time.length})</summary>
              <div className="col" style={{ gap: 3, marginTop: 6 }}>
                {d.time.map((t) => (
                  <span key={t.id} className="tiny">{t.name ?? "Crew"} · {t.kind === "site" ? "on site" : "driving"} · {dayText(t.start.slice(0, 10))} {clock(t.start)}–{clock(t.end)}{t.edited_by ? ` · changed by ${t.edited_by}` : ""}</span>
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <section className="card col" style={{ gap: 8 }}>
          <b>Material used</b>
          {!d.materials.length ? <span className="small muted">Nothing logged.</span> : null}
          {d.materials.map((m) => (
            <div key={m.id} className="col tight">
              <span className="small"><b>{fmt(Number(m.qty), 2)} {m.unit === "set" ? "sets" : m.unit}</b> · {m.name}{m.work_date ? ` · ${dayText(m.work_date)}` : ""}</span>
              {m.kind.startsWith("foam") ? (
                <span className="tiny faint">A-side: {[m.a_maker, m.a_lot].filter(Boolean).join(" ") || "no lot"} · B-side: {m.b_lot || "no lot"}{m.serials ? ` · drums ${m.serials}` : ""}{m.measure?.a != null || m.measure?.b != null ? ` · read ${fmt(m.measure?.a ?? null, 1)} / ${fmt(m.measure?.b ?? null, 1)} ${m.measure?.unit === "gallons" ? "gal" : "lb"}` : ""}{m.measure?.start != null ? ` · counter ${m.measure.start}–${m.measure.end ?? "?"}` : ""}</span>
              ) : m.lot ? <span className="tiny faint">Lot {m.lot}</span> : null}
              {d.mine ? <span className="tiny faint">{m.taken?.length ? `Off stock: ${m.taken.map((t) => `${fmt(t.qty, 2)} ${t.item_key}${t.lot ? ` ${t.lot}` : ""} (${t.place === "rig" ? "rig" : "shop"})`).join(", ")}` : "Not taken off stock (lot not in the app's stock)"}</span> : null}
            </div>
          ))}
          {ys.length ? (
            <div className="col" style={{ gap: 6, marginTop: 4 }}>
              {ys.map((y) => (
                <div key={y.product.id} className="row between small" style={{ gap: 8 }}>
                  <span>{y.product.name}: {fmt(y.bf)} bd ft ÷ {fmt(y.sets, 2)} sets</span>
                  <b>{y.actual === null ? "–" : `${fmt(y.actual)} bd ft/set`}{y.pct !== null ? <span className={`pill ${y.pct >= 90 ? "ok" : y.pct >= 75 ? "warn" : "red"}`} style={{ marginLeft: 6 }}>{y.pct}%</span> : null}</b>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <section className="card col" style={{ gap: 8 }}>
        <b>Application and yield</b>
        {!d.areas.length ? <span className="small muted">No areas.</span> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Area</th><th>Substrate</th><th className="num">Sq ft</th><th className="num">Avg in</th><th className="num">Passes</th><th className="num">Bd ft</th></tr></thead>
              <tbody>
                {d.areas.map((a) => (
                  <tr key={a.id}><td>{[a.area_code, a.name].filter(Boolean).join(" · ") || "–"}</td><td>{a.substrate ?? "–"}</td><td className="num">{fmt(a.sqft)}</td><td className="num">{fmt(a.thick_in, 2)}</td><td className="num">{a.passes ?? "–"}</td><td className="num">{fmt(a.bf)}</td></tr>
                ))}
                <tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{fmt(totSq)}</b></td><td /><td /><td className="num"><b>{fmt(totBf)}</b></td></tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d.days.map((day) => <DayView key={day.id} day={day} />)}

      {d.photos.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b>Photos ({d.photos.length})</b>
          {(["before", "after", "issue", "other"] as const).map((k) => {
            const list = d.photos.filter((p) => p.kind === k);
            if (!list.length) return null;
            return (
              <div key={k} className="col" style={{ gap: 6 }}>
                <span className="tiny faint">{k === "before" ? "Before" : k === "after" ? "After" : k === "issue" ? "Issues" : "Other"}</span>
                <div className="fld-photos">
                  {list.map((p) => (
                    <a key={p.id} href={p.url ?? "#"} target="_blank" rel="noopener" className="fld-photo">
                      {p.url ? <img src={p.url} alt={k} loading="lazy" /> : null}
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {w.notes ? <section className="card col" style={{ gap: 6 }}><b>Job notes</b><span className="small" style={{ whiteSpace: "pre-wrap" }}>{w.notes}</span></section> : null}

      <section className="card col" style={{ gap: 8 }}>
        <b>Sign-off</b>
        <span className="small">Sprayer: {w.sprayer_name ?? "–"}{w.sprayer_cert ? ` · ${w.sprayer_cert}` : ""}{w.sprayer_signed_at ? ` · signed ${when(w.sprayer_signed_at)}` : ""}</span>
        {w.customer_absent ? (
          <span className="small">Customer didn&apos;t sign: {w.customer_absent_note}</span>
        ) : w.customer_sig ? (
          <div className="col tight">
            <span className="small">Customer: {w.customer_name}{w.customer_signed_at ? ` · signed ${when(w.customer_signed_at)}` : ""}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={w.customer_sig} alt={`Signature of ${w.customer_name ?? "the customer"}`} className="wo-sig" />
          </div>
        ) : <span className="small muted">Not signed yet.</span>}
      </section>
    </div>
  );
}

function DayView({ day }: { day: WoDetail["days"][number] }) {
  const c = day.conditions;
  const e = day.equipment;
  const m = day.material;
  const q = day.quality;
  const s = day.safety;
  const rc = obj(c.readings);
  const re = obj(e.readings);
  const prep = obj(c.prep);
  const density = coreDensity(q.cup_mass_g, q.cup_ml);
  const kv = (pairs: [string, unknown][]) => (
    <div className="wo-kv">
      {pairs.map(([k, v]) => <span key={k}><i>{k}</i>{txt(v)}</span>)}
    </div>
  );
  return (
    <section className="card col" style={{ gap: 10 }}>
      <div className="row between"><b>Spray log · {dayText(day.work_date)}</b>{day.updated_by_name ? <span className="tiny faint">{day.updated_by_name}</span> : null}</div>
      {kv([["Sky", c.sky], ["Wind", c.wind], ["Meter", c.meter], ["Primer", c.primer], ["Prep", Object.entries(prep).filter(([, v]) => v).map(([k]) => ({ clean: "Clean", dry: "Dry", no_frost: "No frost", no_oil: "No oil/dust", sound: "Sound" } as R)[k] ?? k).join(", ") || null]])}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th /><th className="num">Time</th><th className="num">Air °F</th><th className="num">RH %</th><th className="num">Dew pt °F</th><th className="num">Substrate °F</th><th className="num">Above dew</th><th className="num">Wood MC %</th></tr></thead>
          <tbody>
            {WHEN.map(([k, l]) => {
              const r = obj(rc[k]);
              const ck = readingChecks(r);
              return (
                <tr key={k}>
                  <td>{l}</td><td className="num">{txt(r.time)}</td><td className="num">{txt(r.ambient)}</td><td className="num">{txt(r.rh)}</td><td className="num">{fmt(ck.dew, 1)}</td><td className="num">{txt(r.substrate)}</td>
                  <td className={`num ${ck.aboveOk === "bad" ? "warn-text" : ""}`}>{fmt(ck.above, 1)}</td><td className={`num ${ck.mcOk === "bad" ? "warn-text" : ""}`}>{txt(r.wood_mc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {kv([["Proportioner", e.proportioner], ["Gun", e.gun], ["Mix chamber", e.chamber], ["Hose ft", e.hose_ft], ["Ratio check", e.ratio], ["Rig log saved", e.rig_log]])}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th /><th className="num">A °F</th><th className="num">B °F</th><th className="num">Hose °F</th><th className="num">A psi</th><th className="num">B psi</th><th className="num">Imbalance</th></tr></thead>
          <tbody>
            {WHEN.map(([k, l]) => {
              const r = obj(re[k]);
              const imb = imbalance(r.a_psi, r.b_psi);
              return (
                <tr key={k}><td>{l}</td><td className="num">{txt(r.a_temp)}</td><td className="num">{txt(r.b_temp)}</td><td className="num">{txt(r.hose_temp)}</td><td className="num">{txt(r.a_psi)}</td><td className="num">{txt(r.b_psi)}</td><td className={`num ${imb !== null && imb > TARGETS.imbalanceMax ? "warn-text" : ""}`}>{fmt(imb)}</td></tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {e.notes ? <span className="small">Equipment notes: {String(e.notes)}</span> : null}
      {kv([["Drum storage °F", m.storage_temp], ["A drum °F", m.a_drum_temp], ["B drum °F", m.b_drum_temp], ["B-side mixed", m.b_mixed], ["Coating", m.coating], ["Wet mils", m.coating_mils]])}
      {kv([["Core density lb/ft³", density !== null ? fmt(density, 2) : null], ["Max pass in", q.max_pass_in], ["Adhesion", q.adhesion], ["Cell structure", q.cell], ["Shrinkage", q.shrinkage], ["Cracking", q.cracking], ["Cure & odor", q.cure], ["Core kept", q.core_kept]])}
      {kv([["Ventilation", s.ventilation], ["Occupants out", s.occupants_out], ["Re-entry hrs", s.reentry_hrs], ["Respirator", s.respirator], ["Signs posted", s.signage], ["Vent after hrs", s.vent_after_hrs]])}
    </section>
  );
}
