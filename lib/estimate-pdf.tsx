import "server-only";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { dateShort, money, plural } from "@/lib/format";
import { LOGO_ASPECT, LOGO_PNG } from "@/lib/order-doc/logo";
import { deliveryText, estNo, partsText, type Estimate, type EstimateItem } from "@/lib/estimates";

// The customer's copy of an unofficial estimate: one Letter page for most, clearly marked as not an order or invoice.

const INK = "#1d1d1f";
const GRAY = "#5b5f66";
const FAINT = "#8a8f97";
const RULE = "#d5d8dd";
const RED = "#e31e24";

Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 50, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 8.6, color: INK },
  topbar: { position: "absolute", top: 0, left: 0, right: 0, height: 6.5, backgroundColor: RED },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { width: 140, height: 140 * LOGO_ASPECT },
  ident: { alignItems: "flex-end" },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 7.4, letterSpacing: 1.3, color: RED },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 20, marginTop: 2, marginBottom: 3, lineHeight: 1.05 },
  meta: { fontSize: 8, color: GRAY, lineHeight: 1.4, textAlign: "right" },
  warn: { marginTop: 10, borderWidth: 1.2, borderColor: RED, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 9 },
  warnT: { fontFamily: "Helvetica-Bold", fontSize: 10.5, letterSpacing: 1.1, color: RED },
  warnS: { marginTop: 2.5, fontSize: 7, lineHeight: 1.35, color: GRAY },
  parties: { flexDirection: "row", marginTop: 12, fontSize: 8.6, lineHeight: 1.35 },
  lbl: { fontFamily: "Helvetica-Bold", fontSize: 6.6, letterSpacing: 1, color: GRAY, paddingBottom: 2.5, marginBottom: 3.5, borderBottomWidth: 0.7, borderBottomColor: RULE },
  name: { fontFamily: "Helvetica-Bold", fontSize: 9.6 },
  sub: { color: GRAY },
  thead: { flexDirection: "row", marginTop: 14, paddingBottom: 3.5, borderBottomWidth: 1.2, borderBottomColor: INK },
  th: { fontFamily: "Helvetica-Bold", fontSize: 6.4, letterSpacing: 0.8, color: GRAY, paddingHorizontal: 5 },
  tr: { flexDirection: "row", paddingVertical: 4.5, borderBottomWidth: 0.7, borderBottomColor: RULE, fontSize: 8.6, lineHeight: 1.35 },
  td: { paddingHorizontal: 5 },
  cN: { width: 20, textAlign: "right", color: FAINT },
  cSku: { width: 80 },
  skuText: { fontSize: 7.6, color: GRAY },
  cDesc: { flex: 1 },
  cQty: { width: 62, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cPrice: { width: 72, textAlign: "right" },
  cAmt: { width: 72, textAlign: "right", fontFamily: "Helvetica-Bold" },
  small: { fontSize: 7, color: GRAY, marginTop: 1 },
  below: { flexDirection: "row", marginTop: 12, alignItems: "flex-start", fontSize: 8.6, lineHeight: 1.35 },
  notes: { flex: 1, marginRight: 22 },
  totals: { width: 215 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  totGrand: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, paddingTop: 5, borderTopWidth: 1.2, borderTopColor: INK, fontFamily: "Helvetica-Bold", fontSize: 11 },
  fine: { fontSize: 6.8, color: GRAY, marginTop: 14, lineHeight: 1.45 },
  foot: { position: "absolute", left: 36, right: 36, bottom: 20, borderTopWidth: 0.7, borderTopColor: RULE, paddingTop: 4, fontSize: 6.6, color: GRAY },
  pageNo: { position: "absolute", left: 36, right: 36, bottom: 20, paddingTop: 4.7, fontSize: 6.6, color: GRAY, textAlign: "right" },
});

const AMBIT_PHONE = "(817) 677-1200";

function EstimatePdf({ est, items, branchName, rep }: { est: Estimate; items: EstimateItem[]; branchName: string | null; rep: { name: string | null; email: string | null } }) {
  const no = estNo(est.est_no);
  const taxLine =
    est.tax_exempt ? "Sales tax (exempt)" : est.tax_rate === null ? "Sales tax" : `Sales tax (${Number(est.tax_rate).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%)`;
  return (
    <Document title={`AMBIT estimate ${no}`} author="AMBIT Polyurethane">
      <Page size="LETTER" style={s.page}>
        <View style={s.topbar} fixed />
        <View style={s.head}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={LOGO_PNG} style={s.logo} />
          <View style={s.ident}>
            <Text style={s.kicker}>UNOFFICIAL ESTIMATE</Text>
            <Text style={s.h1}>{no}</Text>
            <Text style={s.meta}>Priced {dateShort(est.priced_on ?? est.updated_at)}{est.valid_until ? `  ·  Good until ${dateShort(est.valid_until)}` : ""}</Text>
          </View>
        </View>
        <View style={s.warn}>
          <Text style={s.warnT}>ESTIMATE ONLY. NOT AN ORDER OR AN INVOICE</Text>
          <Text style={s.warnS}>
            Prices are from your AMBIT price list on the day shown and can change. Freight and sales tax are estimates. Nothing ships until you place an order.
          </Text>
        </View>
        <View style={s.parties}>
          <View style={{ flex: 1, marginRight: 18 }}>
            <Text style={s.lbl}>PREPARED FOR</Text>
            <Text style={s.name}>{est.company_name}</Text>
          </View>
          <View style={{ flex: 1, marginRight: 18 }}>
            <Text style={s.lbl}>{est.delivery_method === "pickup" ? "PICKUP" : "DELIVERY"}</Text>
            <Text>{deliveryText(est, branchName)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.lbl}>YOUR AMBIT CONTACT</Text>
            <Text style={s.name}>{rep.name ?? "AMBIT Polyurethane"}</Text>
            {rep.email ? <Text style={s.sub}>{rep.email}</Text> : null}
            <Text style={s.sub}>{AMBIT_PHONE}</Text>
          </View>
        </View>

        <View style={s.thead} fixed>
          <Text style={[s.th, s.cN]}>#</Text>
          <Text style={[s.th, s.cSku]}>ITEM</Text>
          <Text style={[s.th, s.cDesc]}>DESCRIPTION</Text>
          <Text style={[s.th, s.cQty]}>QTY</Text>
          <Text style={[s.th, s.cPrice]}>PRICE</Text>
          <Text style={[s.th, s.cAmt]}>AMOUNT</Text>
        </View>
        {items.map((it, i) => {
          const parts = partsText(it, items, money);
          return (
            <View key={it.id} style={s.tr} wrap={false}>
              <Text style={[s.td, s.cN]}>{i + 1}</Text>
              <Text style={[s.td, s.cSku, s.skuText]}>{it.sku}</Text>
              <View style={[s.td, s.cDesc]}>
                <Text>{it.name}</Text>
                {it.basis === "lb" && it.per_price !== null && !parts ? <Text style={s.small}>{money(it.per_price)}/lb</Text> : null}
                {parts ? <Text style={s.small}>{parts}</Text> : null}
              </View>
              <Text style={[s.td, s.cQty]}>{it.qty} {plural(it.unit, it.qty)}</Text>
              <Text style={[s.td, s.cPrice]}>{it.unit_price === null ? "Call" : money(it.unit_price)}</Text>
              <Text style={[s.td, s.cAmt]}>{it.line_total === null ? "–" : money(it.line_total)}</Text>
            </View>
          );
        })}

        <View style={s.below} wrap={false}>
          <View style={s.notes}>
            {est.customer_note ? (
              <>
                <Text style={s.lbl}>NOTES</Text>
                <Text>{est.customer_note}</Text>
              </>
            ) : null}
            {est.freight_note && est.delivery_method !== "pickup" ? <Text style={[s.sub, { marginTop: 6 }]}>Freight: {est.freight_note}</Text> : null}
          </View>
          <View style={s.totals}>
            <View style={s.totRow}><Text>Items</Text><Text>{money(est.subtotal)}</Text></View>
            <View style={s.totRow}>
              <Text>{est.delivery_method === "pickup" ? "Freight (pickup)" : "Freight (quoted)"}</Text>
              <Text>{est.freight === null ? "To be quoted" : money(est.freight)}</Text>
            </View>
            <View style={s.totRow}><Text>{taxLine}</Text><Text>{est.tax === null ? "To be added" : money(est.tax)}</Text></View>
            <View style={s.totGrand}><Text>Estimated total</Text><Text>{money(est.total ?? est.subtotal)}</Text></View>
            {est.has_unpriced ? <Text style={s.small}>Items marked Call are priced when you order.</Text> : null}
          </View>
        </View>

        <Text style={s.fine}>
          This is an unofficial estimate, not an offer to sell, an order, or an invoice. Final prices are set by your AMBIT price list on the day an order is placed, and
          freight is confirmed when the order ships. Sales tax is estimated for the {est.delivery_method === "pickup" ? "pickup location" : "delivery address"} and is not charged
          to customers with a current tax exemption certificate on file. Questions: {rep.email ?? "orders@ambitpu.com"} or {AMBIT_PHONE}.
        </Text>
        <Text style={s.foot} fixed>AMBIT Polyurethane · {no} · Unofficial estimate</Text>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}

export function estimateFileName(est: Pick<Estimate, "est_no" | "company_name">): string {
  const who = est.company_name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `AMBIT-Estimate-${est.est_no}${who ? `-${who}` : ""}.pdf`;
}

export async function renderEstimatePdf(est: Estimate, items: EstimateItem[], branchName: string | null): Promise<Buffer> {
  return renderToBuffer(<EstimatePdf est={est} items={items} branchName={branchName} rep={{ name: est.created_by_name, email: est.created_by_email }} />);
}
