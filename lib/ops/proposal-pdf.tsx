import "server-only";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { groupByArea, type Proposal } from "@/lib/ops/proposal";

// The contractor's proposal as a PDF: their logo and colors (not AMBIT's), the options and add-ons,
// totals, terms, and the signature once it's signed.

Font.registerHyphenationCallback((word) => [word]);

const INK = "#1d1d1f";
const GRAY = "#5b5f66";
const FAINT = "#8a8f97";
const RULE = "#d5d8dd";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "");

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9.4, color: INK },
  bar: { position: "absolute", top: 0, left: 0, right: 0, height: 6 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { maxWidth: 170, maxHeight: 60, objectFit: "contain" },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 18 },
  contact: { alignItems: "flex-end", fontSize: 8.4, color: GRAY, lineHeight: 1.4 },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 7.6, letterSpacing: 1.2, marginTop: 18 },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 20, marginTop: 3, lineHeight: 1.1 },
  sub: { color: GRAY, marginTop: 3, fontSize: 9.4, lineHeight: 1.35 },
  intro: { marginTop: 12, fontSize: 9.6, lineHeight: 1.5 },
  opt: { marginTop: 14, borderWidth: 1, borderColor: RULE, borderRadius: 6, padding: 12 },
  optHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  optName: { fontFamily: "Helvetica-Bold", fontSize: 12.5 },
  optNote: { color: GRAY, fontSize: 8.6, marginTop: 2 },
  optTotal: { fontFamily: "Helvetica-Bold", fontSize: 12.5 },
  area: { marginTop: 8, paddingTop: 5, borderTopWidth: 0.7, borderTopColor: RULE, flexDirection: "row", justifyContent: "space-between" },
  areaT: { fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 1, color: FAINT },
  line: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, fontSize: 9.2, lineHeight: 1.35 },
  detail: { fontSize: 7.8, color: GRAY },
  price: { fontFamily: "Helvetica-Bold", width: 80, textAlign: "right" },
  addons: { marginTop: 14 },
  lbl: { fontFamily: "Helvetica-Bold", fontSize: 7.4, letterSpacing: 1, color: GRAY, paddingBottom: 3, marginBottom: 2, borderBottomWidth: 0.7, borderBottomColor: RULE },
  totals: { marginTop: 14, alignSelf: "flex-end", width: 250 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, fontSize: 9.4 },
  totBig: { flexDirection: "row", justifyContent: "space-between", marginTop: 3, paddingTop: 5, borderTopWidth: 1.2, borderTopColor: INK, fontFamily: "Helvetica-Bold", fontSize: 12 },
  terms: { marginTop: 16, fontSize: 8.2, color: GRAY, lineHeight: 1.45 },
  sign: { marginTop: 18, flexDirection: "row", gap: 24 },
  signBox: { flex: 1, borderTopWidth: 1, borderTopColor: INK, paddingTop: 4, fontSize: 8, color: GRAY },
  sigImg: { width: 190, height: 60, objectFit: "contain" },
  foot: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: FAINT },
});

function ProposalPdf({ p, logo, link }: { p: Proposal; logo: string | null; link: string | null }) {
  const q = p.quote;
  const color = p.company.color && /^#[0-9a-f]{6}$/i.test(p.company.color) ? p.company.color : "#e33527";
  const signed = q.status === "signed";
  const options = signed ? p.options.filter((o) => o.id === q.signed_option_id) : p.options;
  const addons = p.lines.filter((l) => l.option_id === null && (!signed || (q.signed_addons ?? []).includes(l.id)));
  const showPrices = p.company.show_line_prices;
  const t = q.totals ?? {};
  const where = p.property ? [p.property.street, [p.property.city, [p.property.state, p.property.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";
  const one = options.length === 1 ? t.options?.[options[0].id] : null;
  const addTot = addons.reduce((a, l) => a + (signed ? t.addons?.[l.id]?.total ?? 0 : 0), 0);
  return (
    <Document title={`Proposal ${q.number} - ${p.company.name}`} author={p.company.name}>
      <Page size="LETTER" style={s.page} wrap>
        <View style={[s.bar, { backgroundColor: color }]} fixed />
        <View style={s.head}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logo ? <Image src={logo} style={s.logo} /> : <Text style={s.brand}>{p.company.name}</Text>}
          <View style={s.contact}>
            {logo ? <Text style={{ fontFamily: "Helvetica-Bold", color: INK }}>{p.company.name}</Text> : null}
            {p.company.phone ? <Text>{p.company.phone}</Text> : null}
            {p.company.email ? <Text>{p.company.email}</Text> : null}
            {p.company.website ? <Text>{p.company.website}</Text> : null}
            {p.company.license_no ? <Text>License {p.company.license_no}</Text> : null}
          </View>
        </View>
        <Text style={[s.kicker, { color }]}>PROPOSAL #{q.number}{q.sent_at ? `  ·  ${day(q.sent_at).toUpperCase()}` : ""}</Text>
        <Text style={s.h1}>{q.title || "Insulation proposal"}</Text>
        <Text style={s.sub}>For {p.customer?.name ?? "you"}{where ? `  ·  ${where}` : ""}</Text>
        {q.valid_until && !signed ? <Text style={[s.sub, { fontSize: 8.4 }]}>Good until {day(q.valid_until)}</Text> : null}
        {q.intro ? <Text style={s.intro}>{q.intro}</Text> : null}

        {options.map((o) => {
          const mine = p.lines.filter((l) => l.option_id === o.id);
          const ot = t.options?.[o.id];
          return (
            <View key={o.id} style={s.opt} wrap={mine.length > 8}>
              <View style={s.optHead}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={s.optName}>{options.length > 1 || p.options.length > 1 ? o.name : "The work"}</Text>
                  {o.note ? <Text style={s.optNote}>{o.note}</Text> : null}
                </View>
                <Text style={s.optTotal}>{money(ot?.price)}</Text>
              </View>
              {groupByArea(mine, p.company.work_areas).map((g) => (
                <View key={g.code ?? "x"}>
                  <View style={s.area}>
                    <Text style={s.areaT}>{g.name.toUpperCase()}</Text>
                    {showPrices ? <Text style={s.areaT}>{money(g.total)}</Text> : null}
                  </View>
                  {g.lines.map((l) => (
                    <View key={l.id} style={s.line} wrap={false}>
                      <View style={{ flex: 1 }}>
                        <Text>{l.name}</Text>
                        {l.detail ? <Text style={s.detail}>{l.detail}</Text> : null}
                      </View>
                      {showPrices || l.kind === "credit" ? <Text style={s.price}>{money(l.price)}</Text> : null}
                    </View>
                  ))}
                </View>
              ))}
              {ot?.min_adj ? (
                <View style={s.line}><Text style={s.detail}>Minimum job charge</Text><Text style={s.price}>{money(ot.min_adj)}</Text></View>
              ) : null}
            </View>
          );
        })}

        {addons.length ? (
          <View style={s.addons} wrap={false}>
            <Text style={s.lbl}>{signed ? "ADD-ONS PICKED" : "ADD-ONS (OPTIONAL)"}</Text>
            {addons.map((l) => (
              <View key={l.id} style={s.line}>
                <View style={{ flex: 1 }}>
                  <Text>{signed ? "" : "[  ]  "}{l.name}</Text>
                  {l.detail ? <Text style={s.detail}>{l.detail}</Text> : null}
                </View>
                <Text style={s.price}>{money(t.addons?.[l.id]?.price ?? l.price)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.totals} wrap={false}>
          {signed ? (
            <>
              <View style={s.totBig}><Text>Total signed</Text><Text>{money(q.signed_total)}</Text></View>
              {q.deposit_pct ? <View style={s.totRow}><Text>Deposit ({q.deposit_pct}%)</Text><Text>{money(Math.round((q.signed_total ?? 0) * q.deposit_pct) / 100)}</Text></View> : null}
            </>
          ) : one ? (
            <>
              <View style={s.totRow}><Text>Price</Text><Text>{money(one.price)}</Text></View>
              <View style={s.totRow}><Text>Tax</Text><Text>{q.tax_exempt ? "Exempt" : money(one.tax)}</Text></View>
              <View style={s.totBig}><Text>Total</Text><Text>{money(one.total + addTot)}</Text></View>
              {q.deposit_pct ? <View style={s.totRow}><Text>Deposit to schedule ({q.deposit_pct}%)</Text><Text>{money(one.deposit)}</Text></View> : null}
            </>
          ) : (
            options.map((o) => (
              <View key={o.id} style={s.totRow}><Text>{o.name} (with tax)</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{money(t.options?.[o.id]?.total)}</Text></View>
            ))
          )}
        </View>

        {q.terms ? (
          <View style={s.terms} wrap={false}>
            <Text style={s.lbl}>TERMS</Text>
            <Text>{q.terms}</Text>
          </View>
        ) : null}

        <View style={s.sign} wrap={false}>
          <View style={{ flex: 1 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {signed && q.signature ? <Image src={q.signature} style={s.sigImg} /> : <View style={{ height: 60 }} />}
            <View style={s.signBox}><Text>{signed ? (q.signature ? `${q.signed_name}, signed online ${day(q.signed_at)}` : `${q.signed_name}, accepted ${day(q.signed_at)}`) : "Customer signature"}</Text></View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ height: 60 }} />
            <View style={s.signBox}><Text>{signed ? `Accepted: ${options[0]?.name ?? ""}` : "Date"}</Text></View>
          </View>
        </View>
        {link && !signed ? (
          <Text style={[s.sub, { marginTop: 10, fontSize: 8.2 }]}>
            Sign online: <Link src={link}>{link}</Link>
          </Text>
        ) : null}

        <View style={s.foot} fixed>
          <Text>{p.company.name} · Proposal #{q.number}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderProposalPdf(p: Proposal, opts: { logo: string | null; link: string | null }): Promise<Buffer> {
  // react-pdf draws PNG and JPEG only.
  const logo = opts.logo && /\.(png|jpe?g)(\?|$)/i.test(opts.logo) ? opts.logo : null;
  return renderToBuffer(<ProposalPdf p={p} logo={logo} link={opts.link} />);
}

export const proposalFileName = (p: Proposal) => `Proposal ${p.quote.number} - ${p.customer?.name ?? "customer"}.pdf`.replace(/[^\w .()-]+/g, "");
