import "server-only";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { dateShort, jfDate, money } from "@/lib/format";
import { LOGO_ASPECT, LOGO_PNG } from "@/lib/order-doc/logo";
import { fetchJotformFile, type Field, type FormKind, type Section } from "@/lib/forms";
import type { PriceRow, PrfStatus } from "@/lib/jotform";

// Printed Jotform submissions (credit applications, account setups, price requests and every other form),
// in the same look as the printed AMBIT order: white Letter pages, red top bar, logo, status stamp.

const INK = "#1d1d1f";
const GRAY = "#5b5f66";
const FAINT = "#8a8f97";
const RULE = "#d5d8dd";
const ZEBRA = "#f6f7f9";
const RED = "#e31e24";
const GREEN = "#15803d";
const AMBER = "#b45309";

Font.registerHyphenationCallback((word) => [word]);

const AMBIT_PHONE = "(817) 677-1200";
const ORDERS_EMAIL = "orders@ambitpu.com";

const s = StyleSheet.create({
  // No lineHeight on the page: react-pdf drops fixed footers when the page sets one (see the order PDF).
  page: { paddingTop: 34, paddingBottom: 52, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 8.6, color: INK },
  topbar: { position: "absolute", top: 0, left: 0, right: 0, height: 6.5, backgroundColor: RED },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { width: 140, height: 140 * LOGO_ASPECT },
  ident: { alignItems: "flex-end", maxWidth: 330 },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 7.4, letterSpacing: 1.3, color: RED, textAlign: "right" },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 17, marginTop: 2, marginBottom: 5, lineHeight: 1.1, textAlign: "right" },
  stamp: { borderWidth: 1.2, borderRadius: 3, paddingVertical: 2.5, paddingHorizontal: 7, fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 0.7 },
  from: { flexDirection: "row", justifyContent: "space-between", marginTop: 11, paddingBottom: 5, borderBottomWidth: 2, borderBottomColor: INK, fontSize: 7.4, lineHeight: 1.35, color: GRAY },
  b: { fontFamily: "Helvetica-Bold", color: INK },
  facts: { flexDirection: "row", marginTop: 11, borderWidth: 0.7, borderColor: RULE, borderRadius: 2.5, fontSize: 8.6, lineHeight: 1.35 },
  fact: { paddingVertical: 4.5, paddingHorizontal: 6.5 },
  factL: { fontFamily: "Helvetica-Bold", fontSize: 6, letterSpacing: 0.8, color: GRAY },
  factV: { fontFamily: "Helvetica-Bold", fontSize: 8.4, marginTop: 1 },
  secHead: { marginTop: 14, paddingBottom: 3, borderBottomWidth: 1.2, borderBottomColor: INK, flexDirection: "row", justifyContent: "space-between" },
  secT: { fontFamily: "Helvetica-Bold", fontSize: 7.4, letterSpacing: 1.1, color: RED },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: RULE },
  cell: { flex: 1, paddingVertical: 4.5, paddingRight: 8, fontSize: 8.6, lineHeight: 1.35 },
  cellL: { fontSize: 6.9, color: GRAY, marginBottom: 1.2, lineHeight: 1.25 },
  cellV: { fontFamily: "Helvetica-Bold", fontSize: 8.7, lineHeight: 1.35 },
  sig: { height: 44, width: 170, objectFit: "contain", objectPosition: "left", marginTop: 2 },
  box: { marginTop: 16, borderWidth: 1.1, borderColor: INK, borderRadius: 3, paddingVertical: 8, paddingHorizontal: 10, fontSize: 8.6, lineHeight: 1.35 },
  boxT: { fontFamily: "Helvetica-Bold", fontSize: 7.8, letterSpacing: 0.9, marginBottom: 4 },
  line: { flexDirection: "row", alignItems: "flex-end", marginTop: 7 },
  lineL: { fontSize: 7.4, color: GRAY, marginRight: 5 },
  lineRule: { flex: 1, borderBottomWidth: 0.8, borderBottomColor: INK, minHeight: 10 },
  lineV: { fontFamily: "Helvetica-Bold", fontSize: 8, lineHeight: 1.2, marginLeft: 2, marginBottom: 1 },
  thead: { flexDirection: "row", marginTop: 6, paddingBottom: 3.5, borderBottomWidth: 1.2, borderBottomColor: INK },
  th: { fontFamily: "Helvetica-Bold", fontSize: 6.4, letterSpacing: 0.8, color: GRAY, paddingHorizontal: 5 },
  tr: { flexDirection: "row", paddingVertical: 4.5, borderBottomWidth: 0.7, borderBottomColor: RULE, fontSize: 8.6, lineHeight: 1.35 },
  td: { paddingHorizontal: 5 },
  fine: { fontSize: 6.8, color: GRAY, marginTop: 8, lineHeight: 1.4 },
  foot: { position: "absolute", left: 36, right: 36, bottom: 20, borderTopWidth: 0.7, borderTopColor: RULE, paddingTop: 4, paddingRight: 64, fontSize: 6.6, color: GRAY },
  cont: { position: "absolute", left: 36, right: 36, top: 15, fontSize: 6.6, color: GRAY, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 },
  pageNo: { position: "absolute", left: 36, right: 36, bottom: 20, paddingTop: 4.7, fontSize: 6.6, color: GRAY, textAlign: "right" },
});

const up = (t: string) => t.toUpperCase();
type Stamp = { text: string; color: string };

function Header({ kicker, title, stamp, right }: { kicker: string; title: string; stamp: Stamp; right: string }) {
  return (
    <>
      <View style={s.head}>
        <Image src={LOGO_PNG} style={s.logo} />
        <View style={s.ident}>
          <Text style={s.kicker}>{up(kicker)}</Text>
          <Text style={s.h1}>{title}</Text>
          <Text style={[s.stamp, { color: stamp.color, borderColor: stamp.color }]}>{stamp.text}</Text>
        </View>
      </View>
      <View style={s.from}>
        <Text>
          <Text style={s.b}>AMBIT Polyurethane</Text>  ·  {AMBIT_PHONE}  ·  {ORDERS_EMAIL}  ·  www.AMBITPU.com
        </Text>
        <Text>{right}</Text>
      </View>
    </>
  );
}

function Facts({ facts }: { facts: [string, string, number?][] }) {
  return (
    <View style={s.facts}>
      {facts.map(([k, v, f], i) => (
        <View key={k} style={[s.fact, { flex: f ?? 1 }, i ? { borderLeftWidth: 0.7, borderLeftColor: RULE } : {}]}>
          <Text style={s.factL}>{k}</Text>
          <Text style={s.factV}>{v || "-"}</Text>
        </View>
      ))}
    </View>
  );
}

/** Pairs short answers two to a row; long answers, addresses, files and signatures get a row of their own. */
function rowsOf(fields: Field[]): Field[][] {
  const rows: Field[][] = [];
  let pending: Field | null = null;
  for (const f of fields) {
    if (f.wide) {
      if (pending) rows.push([pending]);
      pending = null;
      rows.push([f]);
    } else if (pending) {
      rows.push([pending, f]);
      pending = null;
    } else pending = f;
  }
  if (pending) rows.push([pending]);
  return rows;
}

function Cell({ f, sigs }: { f: Field; sigs: Map<string, string> }) {
  const img = f.signature ? sigs.get(f.signature) : undefined;
  return (
    <View style={s.cell}>
      <Text style={s.cellL}>{f.label}</Text>
      {f.signature ? (
        img ? (
          <>
            <Image src={img} style={s.sig} />
            <Text style={{ fontSize: 6.6, color: GRAY }}>Signed electronically in Jotform</Text>
          </>
        ) : (
          <Text style={s.cellV}>Signed electronically (signature saved in Jotform)</Text>
        )
      ) : f.files ? (
        <Text style={s.cellV}>{f.files.map((x) => x.name).join("\n")}<Text style={{ fontFamily: "Helvetica", color: GRAY }}>{"\n"}Attached in Jotform</Text></Text>
      ) : (
        <Text style={s.cellV}>{f.value}</Text>
      )}
    </View>
  );
}

function Sections({ sections, sigs, firstHeading }: { sections: Section[]; sigs: Map<string, string>; firstHeading: string }) {
  return (
    <>
      {sections.map((sec, i) => (
        <View key={i}>
          {rowsOf(sec.fields).map((r, j) => {
            const row = (
              <View style={s.row} wrap={false}>
                <Cell f={r[0]} sigs={sigs} />
                {r.length > 1 ? <Cell f={r[1]} sigs={sigs} /> : r[0].wide ? null : <View style={s.cell} />}
              </View>
            );
            // The heading travels with its first row, so a heading never sits alone at the bottom of a page.
            return j === 0 ? (
              <View key={j} wrap={false}>
                <View style={s.secHead}>
                  <Text style={s.secT}>{up(sec.heading || (i === 0 ? firstHeading : "More"))}</Text>
                </View>
                {row}
              </View>
            ) : (
              <View key={j}>{row}</View>
            );
          })}
        </View>
      ))}
    </>
  );
}

function Line({ label, value, color }: { label: string; value?: string | null; color?: string }) {
  return (
    <View style={s.line}>
      <Text style={s.lineL}>{label}</Text>
      <View style={s.lineRule}>{value ? <Text style={[s.lineV, color ? { color } : {}]}>{value}</Text> : null}</View>
    </View>
  );
}

function Shell({ title, subject, cont, foot, children }: { title: string; subject: string; cont: string; foot: string; children: React.ReactNode }) {
  return (
    <Document title={title} author="AMBIT Polyurethane" creator="AMBITION" producer="AMBITION" subject={subject}>
      <Page size="LETTER" style={s.page}>
        <View style={s.topbar} fixed />
        <Text style={s.cont} fixed render={({ pageNumber }) => (pageNumber > 1 ? cont : "")} />
        {children}
        <View style={s.foot} fixed>
          <Text>{foot}</Text>
        </View>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}

/** Signature pictures, fetched from Jotform so they print (a missing one prints as "signed electronically"). */
async function signatureImages(sections: Section[]): Promise<Map<string, string>> {
  const urls = sections.flatMap((x) => x.fields).map((f) => f.signature).filter(Boolean) as string[];
  const out = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      const file = await fetchJotformFile(u).catch(() => null);
      if (file && /^image\/(png|jpe?g)/i.test(file.type)) out.set(u, `data:${file.type.split(";")[0]};base64,${Buffer.from(file.body).toString("base64")}`);
    }),
  );
  return out;
}

const printed = () => dateShort(new Date().toISOString());

// ------------------------------------------------------------------ any form
export type FormDocReview = {
  status: "approved" | "declined";
  credit_limit: number | null;
  terms: string | null;
  note: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string;
} | null;

export type FormDocInput = {
  formTitle: string;
  kind: FormKind;
  reviewable: boolean;
  sub: { id: string; created_at: string; updated_at: string | null };
  title: string;
  subtitle: string;
  sections: Section[];
  review: FormDocReview;
};

export async function renderFormPdf(d: FormDocInput): Promise<Buffer> {
  const sigs = await signatureImages(d.sections);
  const r = d.review;
  const credit = d.kind === "credit" || d.kind === "account";
  const stamp: Stamp = !d.reviewable
    ? { text: `SUBMITTED  ·  ${up(jfDate(d.sub.created_at))}`, color: GRAY }
    : r?.status === "approved"
      ? { text: `APPROVED  ·  ${up(dateShort(r.reviewed_at))}`, color: GREEN }
      : r?.status === "declined"
        ? { text: `DECLINED  ·  ${up(dateShort(r.reviewed_at))}`, color: RED }
        : { text: "AWAITING AMBIT REVIEW", color: AMBER };

  const facts: [string, string, number?][] = [
    ["SUBMITTED", jfDate(d.sub.created_at, true), 1.3],
    ["LAST EDITED", d.sub.updated_at ? jfDate(d.sub.updated_at) : "Not edited"],
    ["REFERENCE", d.sub.id, 1.2],
  ];
  if (d.reviewable && credit) {
    facts.push(["CREDIT LIMIT", r?.status === "approved" && r.credit_limit != null ? money(Number(r.credit_limit)) : "-"]);
    facts.push(["TERMS", r?.status === "approved" ? r.terms ?? "-" : "-"]);
  }

  return renderToBuffer(
    <Shell
      title={`${d.formTitle} - ${d.title}`}
      subject={`${d.formTitle} from ${d.title}`}
      cont={`${up(d.formTitle)}  ·  ${up(d.title)}  ·  CONTINUED`}
      foot={`AMBIT Polyurethane  ·  ${d.formTitle}  ·  Ref ${d.sub.id}${credit ? "  ·  CONFIDENTIAL" : ""}  ·  Printed ${printed()}`}
    >
      <Header kicker={d.formTitle} title={d.title} stamp={stamp} right={d.subtitle || `Ref ${d.sub.id}`} />
      <Facts facts={facts} />
      <Sections sections={d.sections} sigs={sigs} firstHeading={d.formTitle} />
      {d.reviewable ? (
        <View style={s.box} wrap={false}>
          <Text style={s.boxT}>FOR AMBIT USE  ·  DECISION</Text>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Line label="Decision" value={r ? (r.status === "approved" ? "APPROVED" : "DECLINED") : null} color={r?.status === "approved" ? GREEN : r ? RED : undefined} />
              {credit ? <Line label="Credit limit" value={r?.status === "approved" && r.credit_limit != null ? money(Number(r.credit_limit)) : null} /> : null}
              {credit ? <Line label="Terms" value={r?.status === "approved" ? r.terms : null} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Line label="Reviewed by" value={r?.reviewed_by_name} />
              <Line label="Date" value={r ? dateShort(r.reviewed_at) : null} />
              <Line label="Account #" />
            </View>
          </View>
          <Line label="Note" value={r?.note} />
          {!r ? <Line label="Signature" /> : null}
        </View>
      ) : null}
    </Shell>,
  );
}

// ------------------------------------------------------------------ price requests
export type PrfDocInput = {
  sub: { id: string; created_at: string; updated_at: string | null };
  customer: string;
  contact: string;
  rep: string;
  status: PrfStatus;
  prices: PriceRow[];
  review: { approved_by_name: string | null; approved_at: string; note: string | null } | null;
  sections: Section[];
};

const asMoney = (v: string) => {
  const t = v.trim();
  return /^\$?\d+(\.\d+)?$/.test(t) ? money(Number(t.replace("$", ""))) : t;
};

export async function renderPrfPdf(d: PrfDocInput): Promise<Buffer> {
  const sigs = await signatureImages(d.sections);
  const asked = d.prices.filter((p) => p.requested || p.approved);
  const title = d.customer || d.contact || "Price request";
  const stamp: Stamp =
    d.status === "approved"
      ? { text: `APPROVED${d.review ? `  ·  ${up(dateShort(d.review.approved_at))}` : ""}`, color: GREEN }
      : d.status === "pending"
        ? { text: "AWAITING PRICE APPROVAL", color: AMBER }
        : { text: "NO PRICES ASKED", color: GRAY };

  return renderToBuffer(
    <Shell
      title={`Price request - ${title}`}
      subject={`AMBIT price request for ${title}`}
      cont={`PRICE REQUEST  ·  ${up(title)}  ·  CONTINUED`}
      foot={`AMBIT Polyurethane  ·  Price Request Form  ·  Ref ${d.sub.id}  ·  CONFIDENTIAL  ·  Printed ${printed()}`}
    >
      <Header kicker="Price request" title={title} stamp={stamp} right={d.rep ? `Sales rep ${d.rep}` : `Ref ${d.sub.id}`} />
      <Facts
        facts={[
          ["SUBMITTED", jfDate(d.sub.created_at, true), 1.3],
          ["CUSTOMER CONTACT", d.contact || "-", 1.2],
          ["SALES REP", d.rep || "-", 1.3],
          ["PRODUCTS", String(asked.length), 0.7],
          ["REFERENCE", d.sub.id, 1.1],
        ]}
      />

      <View style={s.secHead} minPresenceAhead={40}>
        <Text style={s.secT}>PRICING</Text>
      </View>
      {asked.length ? (
        <>
          <View style={s.thead}>
            <Text style={[s.th, { width: 18, textAlign: "right" }]}>#</Text>
            <Text style={[s.th, { flex: 1 }]}>PRODUCT</Text>
            <Text style={[s.th, { width: 120 }]}>SECTION</Text>
            <Text style={[s.th, { width: 70, textAlign: "right" }]}>REQUESTED</Text>
            <Text style={[s.th, { width: 70, textAlign: "right" }]}>APPROVED</Text>
          </View>
          {asked.map((p, i) => (
            <View key={p.reqQid} style={[s.tr, i % 2 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
              <Text style={[s.td, { width: 18, textAlign: "right", color: FAINT }]}>{i + 1}</Text>
              <Text style={[s.td, { flex: 1, fontFamily: "Helvetica-Bold" }]}>{p.product}</Text>
              <Text style={[s.td, { width: 120, color: GRAY }]}>{p.section}</Text>
              <Text style={[s.td, { width: 70, textAlign: "right" }]}>{p.requested ? asMoney(p.requested) : "-"}</Text>
              <Text style={[s.td, { width: 70, textAlign: "right", fontFamily: "Helvetica-Bold", color: p.approved ? GREEN : FAINT }]}>
                {p.approved ? asMoney(p.approved) : d.status === "approved" ? "Not approved" : "Waiting"}
              </Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={{ marginTop: 6, color: GRAY }}>The rep didn&apos;t ask for a price on any product.</Text>
      )}
      <Text style={s.fine}>Approved prices apply to this customer only. Final pricing, tax and freight are confirmed on the AMBIT invoice.</Text>

      <Sections sections={d.sections} sigs={sigs} firstHeading="Request" />

      <View style={s.box} wrap={false}>
        <Text style={s.boxT}>MANAGER APPROVAL</Text>
        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Line label="Approved by" value={d.review?.approved_by_name ?? (d.status === "approved" ? "In Jotform" : null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Line label="Date" value={d.review ? dateShort(d.review.approved_at) : null} />
          </View>
        </View>
        <Line label="Note to the rep" value={d.review?.note} />
      </View>
    </Shell>,
  );
}

const safeName = (t: string) => t.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Form";
export const formPdfName = (formTitle: string, title: string) => `AMBIT-${safeName(formTitle).replace(/^AMBIT-/i, "")}-${safeName(title)}.pdf`;
