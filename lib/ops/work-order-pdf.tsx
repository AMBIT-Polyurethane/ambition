import "server-only";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { TARGETS, coreDensity, imbalance, readingChecks } from "@/lib/ops/field/calc";
import { addressText, hoursByPerson, woLabel, yieldRows, type WoDetail } from "@/lib/ops/work-orders-server";

// The finished work order as a PDF in the layout of AMBIT's Spray Job Data Log (SDL-01), with the
// contractor's name and logo on top. For the contractor's records, the customer, and AMBIT tech support.

Font.registerHyphenationCallback((word) => [word]);

const INK = "#1d1d1f";
const GRAY = "#5b5f66";
const FAINT = "#8a8f97";
const RULE = "#d5d8dd";
const RED = "#c62828";
const tz = "America/Chicago";

const t = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : v === "yes" ? "Yes" : v === "no" ? "No" : String(v));
const n = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: d }));
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }) : "–");
const day = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "–");
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "–");
const hrs = (m: number) => `${(m / 60).toFixed(2)} h`;
type R = Record<string, unknown>;
const obj = (v: unknown): R => (v && typeof v === "object" ? (v as R) : {});

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 46, paddingHorizontal: 34, fontFamily: "Helvetica", fontSize: 8.4, color: INK },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 8 },
  logo: { maxWidth: 150, maxHeight: 46, objectFit: "contain" },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 15 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, textAlign: "right" },
  sub: { fontSize: 7.6, color: GRAY, textAlign: "right", marginTop: 2 },
  sec: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  secNo: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#fff", backgroundColor: INK, paddingHorizontal: 4, paddingVertical: 1.5 },
  secT: { fontFamily: "Helvetica-Bold", fontSize: 8.6, letterSpacing: 0.8 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4, borderTopWidth: 0.6, borderLeftWidth: 0.6, borderColor: RULE },
  cell: { width: "25%", borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: RULE, padding: 3.5 },
  cellW: { width: "50%", borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: RULE, padding: 3.5 },
  lbl: { fontSize: 5.8, color: FAINT, fontFamily: "Helvetica-Bold", letterSpacing: 0.4 },
  val: { fontSize: 8.4, marginTop: 1 },
  table: { marginTop: 4, borderTopWidth: 0.6, borderLeftWidth: 0.6, borderColor: RULE },
  tr: { flexDirection: "row" },
  th: { flex: 1, padding: 3, borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: RULE, fontFamily: "Helvetica-Bold", fontSize: 6.4, color: GRAY, backgroundColor: "#f3f4f6" },
  td: { flex: 1, padding: 3, borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: RULE, fontSize: 7.8 },
  first: { flex: 1.3 },
  bad: { color: RED, fontFamily: "Helvetica-Bold" },
  note: { fontSize: 7, color: GRAY, marginTop: 3 },
  sig: { width: 180, height: 56, objectFit: "contain" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  photo: { width: 120, height: 90, objectFit: "cover" },
  foot: { position: "absolute", bottom: 20, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", fontSize: 6.6, color: FAINT },
});

const Cell = ({ l, v, wide }: { l: string; v: unknown; wide?: boolean }) => (
  <View style={wide ? s.cellW : s.cell}>
    <Text style={s.lbl}>{l.toUpperCase()}</Text>
    <Text style={s.val}>{t(v)}</Text>
  </View>
);
const Sec = ({ no, title }: { no: string; title: string }) => (
  <View style={s.sec} wrap={false}>
    <Text style={s.secNo}>{no}</Text>
    <Text style={s.secT}>{title}</Text>
  </View>
);
function Table({ head, rows, firstWide = true }: { head: string[]; rows: { cells: unknown[]; bad?: boolean[] }[]; firstWide?: boolean }) {
  return (
    <View style={s.table}>
      <View style={s.tr}>{head.map((h, i) => <Text key={i} style={[s.th, i === 0 && firstWide ? s.first : {}]}>{h}</Text>)}</View>
      {rows.map((r, j) => (
        <View key={j} style={s.tr} wrap={false}>
          {r.cells.map((c, i) => <Text key={i} style={[s.td, i === 0 && firstWide ? s.first : {}, r.bad?.[i] ? s.bad : {}]}>{t(c)}</Text>)}
        </View>
      ))}
    </View>
  );
}

const WHEN = [["start", "Start"], ["mid", "Midday"], ["end", "End"]] as const;

function WorkOrderPdf({ d, logo }: { d: WoDetail; logo: string | null }) {
  const w = d.wo;
  const people = hoursByPerson(d.time);
  const ys = yieldRows(d);
  const totSq = d.areas.reduce((a, x) => a + (Number(x.sqft) || 0), 0);
  const totBf = d.areas.reduce((a, x) => a + (Number(x.bf) || 0), 0);
  const lead = d.crew.find((c) => c.lead)?.name ?? w.sprayer_name;
  const pics = d.photos.filter((p) => p.url && (p.kind === "after" || p.kind === "issue" || p.kind === "before")).slice(0, 8);
  return (
    <Document title={`Spray job data log - ${woLabel(d)} - ${d.customer.name}`} author={d.company.brand}>
      <Page size="LETTER" style={s.page} wrap>
        <View style={s.head}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logo ? <Image src={logo} style={s.logo} /> : <Text style={s.brand}>{d.company.brand}</Text>}
          <View>
            <Text style={s.title}>SPRAY JOB DATA LOG</Text>
            <Text style={s.sub}>{woLabel(d)} · {d.trip.name} · Field application record (AMBIT SDL-01)</Text>
          </View>
        </View>

        <Sec no="01" title="CONTRACTOR AND CREW" />
        <View style={s.grid}>
          <Cell l="Company" v={d.company.brand} />
          <Cell l="Phone" v={d.company.phone} />
          <Cell l="License" v={d.company.license_no} />
          <Cell l="Rig / truck" v={d.rig?.name} />
          <Cell l="Lead sprayer" v={lead} />
          <Cell l="Certification" v={w.sprayer_cert} />
          <Cell l="Crew / helpers" v={d.crew.filter((c) => !c.lead).map((c) => c.name).join(", ")} wide />
        </View>

        <Sec no="02" title="JOB" />
        <View style={s.grid}>
          <Cell l="Customer" v={d.customer.name} />
          <Cell l="Job" v={d.job.title} />
          <Cell l="Address" v={addressText(d.property)} wide />
          <Cell l="Dates" v={`${day(d.trip.start_date)}${d.trip.days > 1 ? ` – ${day(d.trip.end_date)}` : ""}`} wide />
          <Cell l="Started" v={dt(w.started_at)} />
          <Cell l="Finished" v={dt(w.finished_at)} />
        </View>

        <Sec no="03" title="TIME ON THE JOB" />
        <Table head={["Crew member", "On site", "Driving", "Punches"]} rows={people.map((p) => ({ cells: [p.name, hrs(p.site), p.drive ? hrs(p.drive) : "–", d.time.filter((x) => (x.name ?? "Crew") === p.name).map((x) => `${clock(x.start)}–${x.end ? clock(x.end) : "open"}${x.kind === "drive" ? " (drive)" : ""}`).join(", ")] }))} />

        <Sec no="04" title="MATERIAL, APPLICATION AND YIELD" />
        <Table
          head={["Material", "Used", "A-side maker / lot", "B-side lot", "Drums", "Read"]}
          rows={d.materials.map((m) => ({
            cells: [
              m.name,
              `${n(Number(m.qty), 2)} ${m.unit === "set" ? "sets" : m.unit}`,
              m.kind.startsWith("foam") ? [m.a_maker, m.a_lot].filter(Boolean).join(" ") || "–" : m.lot ?? "–",
              m.kind.startsWith("foam") ? m.b_lot ?? "–" : "–",
              m.serials ?? "–",
              m.measure?.a != null || m.measure?.b != null ? `${n(m.measure?.a ?? null, 1)} / ${n(m.measure?.b ?? null, 1)} ${m.measure?.unit === "gallons" ? "gal" : "lb"}` : m.measure?.start != null ? `counter ${m.measure.start}–${m.measure.end ?? "?"}` : "–",
            ],
          }))}
        />
        <Table
          head={["Area", "Substrate", "Sq ft", "Avg thick (in)", "Passes", "Board feet"]}
          rows={[
            ...d.areas.map((a) => ({ cells: [[a.area_code, a.name].filter(Boolean).join(" · ") || "–", a.substrate, n(a.sqft), n(a.thick_in, 2), a.passes, n(a.bf)] })),
            { cells: ["Total", "", n(totSq), "", "", n(totBf)] },
          ]}
        />
        {ys.length ? (
          <Table
            head={["Foam", "Board feet", "Sets used", "Actual yield (bd ft/set)", "Expected", "% of expected"]}
            rows={ys.map((y) => ({ cells: [y.product.name, n(y.bf), n(y.sets, 2), n(y.actual), n(y.expected), y.pct === null ? "–" : `${y.pct}%`], bad: [false, false, false, false, false, y.pct !== null && y.pct < 75] }))}
          />
        ) : null}
        <Text style={s.note}>Board feet = sq ft × average thickness (in). Actual yield = total board feet ÷ sets used.</Text>

        {d.days.map((dy) => {
          const c = dy.conditions;
          const e = dy.equipment;
          const m = dy.material;
          const q = dy.quality;
          const sf = dy.safety;
          const rc = obj(c.readings);
          const re = obj(e.readings);
          const prep = obj(c.prep);
          return (
            <View key={dy.id}>
              <Sec no="05" title={`SITE AND SUBSTRATE · ${day(dy.work_date).toUpperCase()}`} />
              <View style={s.grid}>
                <Cell l="Sky" v={c.sky} />
                <Cell l="Wind" v={c.wind} />
                <Cell l="Meter used" v={c.meter} />
                <Cell l="Primer" v={c.primer} />
                <Cell l="Substrate prep" v={["clean", "dry", "no_frost", "no_oil", "sound"].filter((k) => prep[k]).map((k) => ({ clean: "Clean", dry: "Dry", no_frost: "No frost/dew", no_oil: "No oil/dust", sound: "Sound & fastened" } as R)[k]).join(", ")} wide />
              </View>
              <Table
                head={["Reading", "Time", "Air °F", "RH %", "Dew point °F", "Substrate °F", `Above dew (min ${TARGETS.aboveDewF})`, `Wood MC % (max ${TARGETS.woodMcMax})`]}
                rows={WHEN.map(([k, l]) => {
                  const r = obj(rc[k]);
                  const ck = readingChecks(r);
                  return { cells: [l, r.time, r.ambient, r.rh, n(ck.dew, 1), r.substrate, n(ck.above, 1), r.wood_mc], bad: [false, false, false, false, false, false, ck.aboveOk === "bad", ck.mcOk === "bad"] };
                })}
              />
              <Sec no="06" title="EQUIPMENT AND SETTINGS" />
              <View style={s.grid}>
                <Cell l="Proportioner" v={e.proportioner} />
                <Cell l="Spray gun" v={e.gun} />
                <Cell l="Mix chamber" v={e.chamber} />
                <Cell l="Hose length ft" v={e.hose_ft} />
                <Cell l="Ratio check" v={e.ratio} />
                <Cell l="Rig data log saved" v={e.rig_log} />
                <Cell l="Equipment notes" v={e.notes} wide />
              </View>
              <Table
                head={["Reading", "A (iso) °F", "B (resin) °F", "Hose °F", "A psi", "B psi", `Imbalance (max ${TARGETS.imbalanceMax})`]}
                rows={WHEN.map(([k, l]) => {
                  const r = obj(re[k]);
                  const imb = imbalance(r.a_psi, r.b_psi);
                  return { cells: [l, r.a_temp, r.b_temp, r.hose_temp, r.a_psi, r.b_psi, n(imb)], bad: [false, false, false, false, false, false, imb !== null && imb > TARGETS.imbalanceMax] };
                })}
              />
              <View style={s.grid}>
                <Cell l="Drum storage °F" v={m.storage_temp} />
                <Cell l="A drum at spray °F" v={m.a_drum_temp} />
                <Cell l="B drum at spray °F" v={m.b_drum_temp} />
                <Cell l="B-side mixed" v={m.b_mixed} />
                <Cell l="Coating / barrier" v={m.coating} />
                <Cell l="Coating wet mils" v={m.coating_mils} />
              </View>
              <Sec no="07" title="QUALITY CHECKS" />
              <View style={s.grid}>
                <Cell l="Cup foam mass g" v={q.cup_mass_g} />
                <Cell l="Cup volume mL" v={q.cup_ml} />
                <Cell l="Core density lb/ft³" v={n(coreDensity(q.cup_mass_g, q.cup_ml), 2)} />
                <Cell l="Max single pass in" v={q.max_pass_in} />
                <Cell l="Adhesion" v={q.adhesion} />
                <Cell l="Cell structure / color" v={q.cell} />
                <Cell l="Shrinkage / pull-away" v={q.shrinkage} />
                <Cell l="Cracking / fissures" v={q.cracking} />
                <Cell l="Cure and odor" v={q.cure} />
                <Cell l="Core sample kept" v={q.core_kept} />
              </View>
              <Sec no="08" title="SAFETY AND RE-OCCUPANCY" />
              <View style={s.grid}>
                <Cell l="Ventilation during spray" v={sf.ventilation} wide />
                <Cell l="Occupants out" v={sf.occupants_out} />
                <Cell l="Re-entry time posted hrs" v={sf.reentry_hrs} />
                <Cell l="Sprayer respirator" v={sf.respirator} />
                <Cell l="Warning signs posted" v={sf.signage} />
                <Cell l="Ventilation after hrs" v={sf.vent_after_hrs} />
              </View>
            </View>
          );
        })}

        <Sec no="09" title="ISSUES AND NOTES" />
        <View style={s.grid}>
          <Cell l="Issue encountered" v={w.issue ?? "None"} wide />
          <Cell l="Affected installed foam" v={w.issue_affected === "unsure" ? "Not sure" : w.issue_affected} />
          <Cell l="AMBIT tech support contacted" v={w.tech_contacted === null ? null : w.tech_contacted ? "Yes" : "No"} />
          <Cell l="Corrective action" v={w.corrective} wide />
          <Cell l="Job notes" v={w.notes} wide />
        </View>

        {pics.length ? (
          <View wrap={false}>
            <Sec no="—" title={`PHOTOS (${d.photos.length} ON FILE)`} />
            <View style={s.photos}>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              {pics.map((p) => <Image key={p.id} src={p.url!} style={s.photo} />)}
            </View>
          </View>
        ) : null}

        <View wrap={false}>
          <Sec no="10" title="SIGN-OFF" />
          <View style={s.grid}>
            <Cell l="Sprayer" v={w.sprayer_name} />
            <Cell l="Signed" v={dt(w.sprayer_signed_at)} />
            <Cell l="Reviewed by" v={w.reviewed_by_name} />
            <Cell l="Review date" v={dt(w.reviewed_at)} />
          </View>
          <Text style={s.note}>The sprayer confirmed the information in this log is accurate to the best of their knowledge.</Text>
          <View style={{ marginTop: 8 }}>
            <Text style={s.lbl}>CUSTOMER</Text>
            {w.customer_absent ? (
              <Text style={s.val}>Not signed: {t(w.customer_absent_note)}</Text>
            ) : w.customer_sig ? (
              <View>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={w.customer_sig} style={s.sig} />
                <Text style={s.val}>{w.customer_name} · {dt(w.customer_signed_at)}</Text>
              </View>
            ) : <Text style={s.val}>–</Text>}
          </View>
        </View>

        <View style={s.foot} fixed>
          <Text>{d.company.brand} · {woLabel(d)} · Targets: substrate ≥ 5°F above dew point · wood ≤ 19% · A/B within 200 psi (general SPF practice; the AMBIT TDS governs)</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderWorkOrderPdf(d: WoDetail, opts: { logo: string | null }) {
  return renderToBuffer(<WorkOrderPdf d={d} logo={opts.logo} />);
}

export const workOrderFileName = (d: WoDetail) => `Spray log ${woLabel(d).replace(/[^\w#-]+/g, " ").trim()} ${d.customer.name.replace(/[^\w ]+/g, "").trim()}.pdf`.replace(/\s+/g, " ");
