import "server-only";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { dateShort, money } from "@/lib/format";
import { LOGO_ASPECT, LOGO_PNG } from "@/lib/order-doc/logo";
import { fetchJotformFile } from "@/lib/forms";
import { shrinkImage } from "@/lib/image-shrink";
import { monthLabel, totals, type Receipt } from "@/lib/expenses";

// The monthly expense report: a summary page (totals, categories, every receipt in a table) and then
// the receipt photos, two to a page, each labeled with its line number.

const INK = "#1d1d1f";
const GRAY = "#5b5f66";
const RULE = "#d5d8dd";
const ZEBRA = "#f6f7f9";
const RED = "#e31e24";
const GREEN = "#15803d";

Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
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
  facts: { flexDirection: "row", marginTop: 11, borderWidth: 0.7, borderColor: RULE, borderRadius: 2.5 },
  fact: { paddingVertical: 5, paddingHorizontal: 7 },
  factL: { fontFamily: "Helvetica-Bold", fontSize: 6, letterSpacing: 0.8, color: GRAY },
  factV: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 2 },
  secHead: { marginTop: 14, paddingBottom: 3, borderBottomWidth: 1.2, borderBottomColor: INK, flexDirection: "row", justifyContent: "space-between" },
  secT: { fontFamily: "Helvetica-Bold", fontSize: 7.4, letterSpacing: 1.1, color: RED },
  thead: { flexDirection: "row", marginTop: 6, paddingBottom: 3.5, borderBottomWidth: 1.2, borderBottomColor: INK },
  th: { fontFamily: "Helvetica-Bold", fontSize: 6.4, letterSpacing: 0.8, color: GRAY, paddingHorizontal: 4 },
  tr: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.7, borderBottomColor: RULE, fontSize: 8.2, lineHeight: 1.3 },
  td: { paddingHorizontal: 4 },
  tot: { flexDirection: "row", paddingVertical: 5, borderTopWidth: 1.2, borderTopColor: INK, fontFamily: "Helvetica-Bold", fontSize: 9.4 },
  fine: { fontSize: 6.8, color: GRAY, marginTop: 8, lineHeight: 1.4 },
  sign: { flexDirection: "row", marginTop: 22 },
  signLine: { flex: 1, borderTopWidth: 0.8, borderTopColor: INK, paddingTop: 3, fontSize: 7, color: GRAY, marginRight: 18 },
  foot: { position: "absolute", left: 36, right: 36, bottom: 20, borderTopWidth: 0.7, borderTopColor: RULE, paddingTop: 4, paddingRight: 64, fontSize: 6.6, color: GRAY },
  cont: { position: "absolute", left: 36, right: 36, top: 15, fontSize: 6.6, color: GRAY, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 },
  pageNo: { position: "absolute", left: 36, right: 36, bottom: 20, paddingTop: 4.7, fontSize: 6.6, color: GRAY, textAlign: "right" },
  photoBox: { height: 318, marginTop: 10, borderWidth: 0.7, borderColor: RULE, borderRadius: 3, padding: 8 },
  photoCap: { flexDirection: "row", justifyContent: "space-between", fontSize: 8, marginBottom: 6 },
  photo: { flex: 1, objectFit: "contain" },
  noPhoto: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: ZEBRA, fontSize: 8, color: GRAY },
});

const up = (t: string) => t.toUpperCase();
const day = (d: string) => dateShort(d);

const COLS = [
  { k: "#", w: 18, align: "left" as const },
  { k: "DATE", w: 58 },
  { k: "VENDOR", w: 112 },
  { k: "CATEGORY", w: 86 },
  { k: "WHAT FOR", flex: 1 },
  { k: "PAID", w: 44 },
  { k: "AMOUNT", w: 62, align: "right" as const },
];

function Row({ cells, style, bold }: { cells: string[]; style?: Style; bold?: boolean }) {
  return (
    <View style={[s.tr, style ?? {}]} wrap={false}>
      {COLS.map((c, i) => (
        <Text
          key={c.k}
          style={[s.td, c.w ? { width: c.w } : { flex: 1 }, { textAlign: c.align ?? "left" }, bold || i === COLS.length - 1 ? { fontFamily: "Helvetica-Bold" } : {}]}
        >
          {cells[i]}
        </Text>
      ))}
    </View>
  );
}

export type ExpenseDocInput = {
  name: string;
  email: string;
  month: string; // YYYY-MM
  receipts: Receipt[];
  sentAt?: string | null;
};

/** Receipt photos as small JPEGs (a PDF receipt or an unreadable photo prints as a note instead). */
async function photos(receipts: Receipt[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const jobs = receipts.flatMap((r) => r.files.map((u) => ({ key: u })));
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { key } = jobs[i++];
      try {
        const file = await fetchJotformFile(key);
        const small = file ? await shrinkImage(file.body, 1100, 68) : null;
        out.set(key, small ? `data:image/jpeg;base64,${small.body.toString("base64")}` : null);
      } catch {
        out.set(key, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  return out;
}

export async function renderExpensePdf(d: ExpenseDocInput): Promise<Buffer> {
  // Oldest first on paper, like a statement.
  const list = [...d.receipts].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  const t = totals(list);
  const pics = await photos(list);
  const title = monthLabel(d.month);
  const shots = list.flatMap((r, n) => (r.files.length ? r.files.map((u, k) => ({ r, n: n + 1, u, k, of: r.files.length })) : [{ r, n: n + 1, u: "", k: 0, of: 0 }]));
  const pairs: (typeof shots)[] = [];
  for (let i = 0; i < shots.length; i += 2) pairs.push(shots.slice(i, i + 2));
  const printed = dateShort(new Date().toISOString());
  const foot = `AMBIT Polyurethane  ·  Expense report  ·  ${d.name}  ·  ${title}  ·  Printed ${printed}`;
  const cont = `EXPENSE REPORT  ·  ${up(d.name)}  ·  ${up(title)}  ·  CONTINUED`;
  const stamp = d.sentAt ? { text: `SENT TO CORPORATE  ·  ${up(day(d.sentAt))}`, color: GREEN } : { text: `${t.count} ${t.count === 1 ? "RECEIPT" : "RECEIPTS"}`, color: GRAY };

  return renderToBuffer(
    <Document title={`Expense report - ${d.name} - ${title}`} author="AMBIT Polyurethane" creator="AMBIT Intelligence" producer="AMBIT Intelligence" subject={`Expense report for ${title}`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.topbar} fixed />
        <Text style={s.cont} fixed render={({ pageNumber }) => (pageNumber > 1 ? cont : "")} />

        <View style={s.head}>
          <Image src={LOGO_PNG} style={s.logo} />
          <View style={s.ident}>
            <Text style={s.kicker}>EMPLOYEE EXPENSE REPORT</Text>
            <Text style={s.h1}>{title}</Text>
            <Text style={[s.stamp, { color: stamp.color, borderColor: stamp.color }]}>{stamp.text}</Text>
          </View>
        </View>
        <View style={s.from}>
          <Text>
            <Text style={s.b}>{d.name}</Text>  ·  {d.email}
          </Text>
          <Text>AMBIT Polyurethane  ·  www.AMBITPU.com</Text>
        </View>

        <View style={s.facts}>
          {([
            ["TOTAL", money(t.total), 1.2],
            ["AMBIT CARD", money(t.card), 1],
            ["PAY BACK TO EMPLOYEE", money(t.personal), 1.3],
            ["RECEIPTS", String(t.count), 0.8],
          ] as [string, string, number][]).map(([k, v, f], i) => (
            <View key={k} style={[s.fact, { flex: f }, i ? { borderLeftWidth: 0.7, borderLeftColor: RULE } : {}]}>
              <Text style={s.factL}>{k}</Text>
              <Text style={[s.factV, k === "PAY BACK TO EMPLOYEE" && t.personal > 0 ? { color: RED } : {}]}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={s.secHead}>
          <Text style={s.secT}>BY CATEGORY</Text>
        </View>
        {t.byCategory.map((c, i) => (
          <View key={c.category} style={[s.tr, i % 2 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
            <Text style={[s.td, { flex: 1 }]}>{c.category}</Text>
            <Text style={[s.td, { width: 80, color: GRAY }]}>{c.count} {c.count === 1 ? "receipt" : "receipts"}</Text>
            <Text style={[s.td, { width: 70, textAlign: "right", fontFamily: "Helvetica-Bold" }]}>{money(c.total)}</Text>
          </View>
        ))}

        <View style={s.secHead}>
          <Text style={s.secT}>RECEIPTS</Text>
          <Text style={{ fontSize: 6.6, color: GRAY }}>Photos follow, numbered to match</Text>
        </View>
        <View style={s.thead} fixed={false}>
          {COLS.map((c) => (
            <Text key={c.k} style={[s.th, c.w ? { width: c.w } : { flex: 1 }, { textAlign: c.align ?? "left" }]}>{c.k}</Text>
          ))}
        </View>
        {list.map((r, i) => (
          <Row
            key={r.id}
            style={i % 2 ? { backgroundColor: ZEBRA } : undefined}
            cells={[
              String(i + 1),
              day(r.date),
              r.vendor || "-",
              r.category,
              [r.purpose, r.notes].filter(Boolean).join(" · ") || "-",
              r.paidWith === "personal" ? "Personal" : "Card",
              r.amount === null ? "?" : money(r.amount),
            ]}
          />
        ))}
        <View style={s.tot} wrap={false}>
          <Text style={{ flex: 1, paddingHorizontal: 4 }}>Total for {title}</Text>
          <Text style={{ width: 90, textAlign: "right", paddingHorizontal: 4 }}>{money(t.total)}</Text>
        </View>
        {t.missing ? <Text style={s.fine}>{t.missing} receipt{t.missing === 1 ? " has" : "s have"} no amount typed in (marked ?). Check the photo.</Text> : null}
        <Text style={s.fine}>
          &quot;Card&quot; = paid with the AMBIT company card. &quot;Personal&quot; = paid with the employee&apos;s own money; the &quot;Pay back to employee&quot; total is owed to them.
        </Text>
        <View style={s.sign} wrap={false}>
          <Text style={s.signLine}>Employee signature / date</Text>
          <Text style={s.signLine}>Approved by / date</Text>
        </View>

        {pairs.map((pair, pi) => (
          <View key={pi} break={pi === 0} wrap={false}>
            {pi === 0 ? (
              <View style={[s.secHead, { marginTop: 0 }]}>
                <Text style={s.secT}>RECEIPT PHOTOS</Text>
              </View>
            ) : null}
            {pair.map((x) => {
              const src = x.u ? pics.get(x.u) : null;
              return (
                <View key={`${x.r.id}-${x.k}`} style={s.photoBox}>
                  <View style={s.photoCap}>
                    <Text>
                      <Text style={s.b}>#{x.n}  {x.r.vendor || "Receipt"}</Text>  ·  {day(x.r.date)}  ·  {x.r.category}
                      {x.of > 1 ? `  ·  photo ${x.k + 1} of ${x.of}` : ""}
                    </Text>
                    <Text style={s.b}>{x.r.amount === null ? "" : money(x.r.amount)}</Text>
                  </View>
                  {src ? (
                    <Image src={src} style={s.photo} />
                  ) : (
                    <View style={s.noPhoto}>
                      <Text>{x.u ? "This receipt is a PDF or a photo type that can't print here. It's saved in Jotform." : "No photo was uploaded with this receipt."}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        <View style={s.foot} fixed>
          <Text>{foot}</Text>
        </View>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>,
  );
}

export const expensePdfName = (name: string, month: string) =>
  `AMBIT expense report - ${name.replace(/[^\w .-]+/g, "").trim() || "employee"} - ${month}.pdf`;
