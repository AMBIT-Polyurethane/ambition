import "server-only";
import { Document, Font, Image, Link, Page, Path, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { DELIVERY_LABEL, dateShort, dateTime, money, orderNo, qtyText } from "@/lib/format";
import { LOGO_ASPECT, LOGO_PNG } from "@/lib/order-doc/logo";
import { awaitingCustomer, type OrderDoc } from "@/lib/order-doc/types";

// The printed AMBIT order: white, one Letter page for most orders, more pages when it needs them.
// Same layout as the approved sample (AMBIT Order Document - Samples.pdf).

const INK = "#1d1d1f";
const GRAY = "#5b5f66";
const FAINT = "#8a8f97";
const RULE = "#d5d8dd";
const ZEBRA = "#f6f7f9";
const RED = "#e31e24";
const GREEN = "#15803d";
const AMBER = "#b45309";

// Never break words (emails, SKUs) with hyphens.
Font.registerHyphenationCallback((word) => [word]);

const AMBIT_PHONE = "(817) 677-1200";
const ORDERS_EMAIL = "orders@ambitpu.com";

const s = StyleSheet.create({
  // No lineHeight on the page itself: react-pdf drops the page-number footer when the page sets one.
  // Sections set it instead, always next to a fontSize (otherwise react-pdf measures it against 18 pt).
  page: { paddingTop: 34, paddingBottom: 50, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 8.6, color: INK },
  topbar: { position: "absolute", top: 0, left: 0, right: 0, height: 6.5, backgroundColor: RED },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { width: 140, height: 140 * LOGO_ASPECT },
  ident: { alignItems: "flex-end" },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 7.4, letterSpacing: 1.3, color: RED },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 20, marginTop: 2, marginBottom: 5, lineHeight: 1.05 },
  stamp: { borderWidth: 1.2, borderRadius: 3, paddingVertical: 2.5, paddingHorizontal: 7, fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 0.7 },
  from: { flexDirection: "row", justifyContent: "space-between", marginTop: 11, paddingBottom: 5, borderBottomWidth: 2, borderBottomColor: INK, fontSize: 7.4, lineHeight: 1.35, color: GRAY },
  b: { fontFamily: "Helvetica-Bold", color: INK },
  parties: { flexDirection: "row", marginTop: 11, fontSize: 8.6, lineHeight: 1.35 },
  lbl: { fontFamily: "Helvetica-Bold", fontSize: 6.6, letterSpacing: 1, color: GRAY, paddingBottom: 2.5, marginBottom: 3.5, borderBottomWidth: 0.7, borderBottomColor: RULE },
  name: { fontFamily: "Helvetica-Bold", fontSize: 9.6 },
  sub: { color: GRAY },
  method: { fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 0.6, color: RED, marginBottom: 1.5 },
  facts: { flexDirection: "row", marginTop: 11, borderWidth: 0.7, borderColor: RULE, borderRadius: 2.5, fontSize: 8.6, lineHeight: 1.35 },
  fact: { paddingVertical: 4.5, paddingHorizontal: 6.5 },
  factL: { fontFamily: "Helvetica-Bold", fontSize: 6, letterSpacing: 0.8, color: GRAY },
  factV: { fontFamily: "Helvetica-Bold", fontSize: 8.4, marginTop: 1 },
  thead: { flexDirection: "row", marginTop: 13, paddingBottom: 3.5, borderBottomWidth: 1.2, borderBottomColor: INK },
  th: { fontFamily: "Helvetica-Bold", fontSize: 6.4, letterSpacing: 0.8, color: GRAY, paddingHorizontal: 5 },
  tr: { flexDirection: "row", paddingVertical: 4.5, borderBottomWidth: 0.7, borderBottomColor: RULE, fontSize: 8.6, lineHeight: 1.35 },
  td: { paddingHorizontal: 5 },
  cN: { width: 20, textAlign: "right", color: FAINT },
  cSku: { width: 76 },
  skuText: { fontSize: 7.6, color: GRAY },
  cDesc: { flex: 1 },
  cQty: { width: 60, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cPrice: { width: 72, textAlign: "right" },
  cAmt: { width: 68, textAlign: "right", fontFamily: "Helvetica-Bold" },
  acct: { fontFamily: "Helvetica-Bold", fontSize: 7.2, color: GRAY },
  below: { flexDirection: "row", marginTop: 11, alignItems: "flex-start", fontSize: 8.6, lineHeight: 1.35 },
  notes: { flex: 1, marginRight: 22 },
  totals: { width: 205 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  totGrand: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, paddingTop: 5, borderTopWidth: 1.2, borderTopColor: INK },
  fine: { fontSize: 6.8, color: GRAY, marginTop: 9, lineHeight: 1.4 },
  boxes: { flexDirection: "row", marginTop: 16, fontSize: 8.6, lineHeight: 1.35 },
  box: { borderWidth: 1.1, borderColor: INK, borderRadius: 3, paddingVertical: 8, paddingHorizontal: 10 },
  h3: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  h3t: { fontFamily: "Helvetica-Bold", fontSize: 7.8, letterSpacing: 0.9 },
  rec: { flexDirection: "row", marginTop: 1.5 },
  dt: { width: 86, color: GRAY },
  dd: { flex: 1, fontFamily: "Helvetica-Bold" },
  line: { flexDirection: "row", alignItems: "flex-end", marginTop: 7 },
  lineL: { fontSize: 7.4, color: GRAY, marginRight: 5 },
  lineRule: { flex: 1, borderBottomWidth: 0.8, borderBottomColor: INK, height: 10 },
  btn: { backgroundColor: RED, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 7.6, letterSpacing: 1, paddingVertical: 4.5, paddingHorizontal: 11, borderRadius: 3, textDecoration: "none" },
  foot: { position: "absolute", left: 36, right: 36, bottom: 20, borderTopWidth: 0.7, borderTopColor: RULE, paddingTop: 4, fontSize: 6.6, color: GRAY },
  // A separate fixed Text: react-pdf skips page numbers rendered inside a fixed View.
  cont: { position: "absolute", left: 36, right: 36, top: 15, fontSize: 6.6, color: GRAY, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 },
  pageNo: { position: "absolute", left: 36, right: 36, bottom: 20, paddingTop: 4.7, fontSize: 6.6, color: GRAY, textAlign: "right" },
});

const up = (t: string) => t.toUpperCase();

function Check({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" style={{ marginRight: 5 }}>
      <Path d="M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22z" fill={color} />
      <Path d="M6.5 12.5l3.6 3.6l7.4-7.6" stroke="#ffffff" strokeWidth={2.6} fill="none" />
    </Svg>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={s.lbl}>{up(children)}</Text>;
}

function Rec({ rows }: { rows: [string, string][] }) {
  return (
    <View>
      {rows.map(([k, v]) => (
        <View key={k} style={s.rec}>
          <Text style={s.dt}>{k}</Text>
          <Text style={s.dd}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function OfficeBox({ pickup }: { pickup: boolean }) {
  const Line = ({ label }: { label: string }) => (
    <View style={s.line}>
      <Text style={s.lineL}>{label}</Text>
      <View style={s.lineRule} />
    </View>
  );
  const Two = ({ a, b }: { a: string; b: string }) => (
    <View style={{ flexDirection: "row" }}>
      <View style={{ flex: 1.4, marginRight: 10 }}><Line label={a} /></View>
      <View style={{ flex: 1 }}><Line label={b} /></View>
    </View>
  );
  return (
    <View style={[s.box, { flex: 1, marginLeft: 14 }]}>
      <View style={s.h3}><Text style={s.h3t}>FOR AMBIT USE</Text></View>
      <Two a="Picked by" b="Date" />
      <Two a="Checked by" b="Date" />
      <Line label="Lot numbers" />
      {pickup ? (
        <>
          <Two a="Picked up by (print)" b="Date" />
          <Line label="Customer signature" />
        </>
      ) : (
        <Two a="Shipped via / truck" b="Date" />
      )}
      <Line label="QuickBooks invoice #" />
    </View>
  );
}

function ApprovalBox({ doc, approveUrl, qr }: { doc: OrderDoc; approveUrl: string | null; qr: string | null }) {
  const o = doc.order;
  const sentTo = o.approval_email ?? doc.company?.email ?? "the customer";

  if (doc.state === "pending" || doc.state === "changes_requested" || doc.state === "expired") {
    const title =
      doc.state === "expired" ? "APPROVAL LINK EXPIRED" : doc.state === "changes_requested" ? "CHANGES REQUESTED" : "YOUR APPROVAL IS NEEDED";
    return (
      <View style={[s.box, { flex: 1, borderColor: AMBER }]}>
        <View style={s.h3}><Text style={[s.h3t, { color: AMBER }]}>{title}</Text></View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            {doc.state === "changes_requested" ? (
              <Text style={{ marginBottom: 4 }}>
                The customer asked for changes{o.approval_note ? `: "${o.approval_note}"` : "."} AMBIT will send an updated order to approve.
              </Text>
            ) : (
              <>
                <Text style={{ marginBottom: 4 }}>
                  Check the items, quantities, ship-to address and PO above. <Text style={s.b}>Nothing is picked or shipped until you approve.</Text>
                </Text>
                <Text style={{ marginBottom: 2 }}>
                  1. Tap Approve order in the email we sent to {sentTo}{qr ? ", or scan the code" : ""}.
                </Text>
                <Text style={{ marginBottom: 5 }}>
                  2. Need a change? Call or email {o.placed_by_name ?? "your AMBIT rep"}
                  {o.placed_by_phone ? ` at ${o.placed_by_phone}` : o.placed_by_email ? ` at ${o.placed_by_email}` : ""} before you approve.
                </Text>
              </>
            )}
            {approveUrl && doc.state === "pending" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Link src={approveUrl} style={s.btn}>APPROVE ORDER</Link>
                {o.approval_expires_at ? (
                  <Text style={{ fontSize: 6.8, color: GRAY, marginLeft: 8 }}>This link expires {dateShort(o.approval_expires_at)}.</Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {qr && doc.state === "pending" ? (
            <View style={{ width: 70, alignItems: "center", marginLeft: 12 }}>
              <Image src={qr} style={{ width: 64, height: 64 }} />
              <Text style={{ fontSize: 6.2, color: GRAY, marginTop: 1 }}>Scan to approve</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  if (doc.state === "approved") {
    const byCustomerName = [o.approved_by_name, o.company_name].filter(Boolean).join(", ");
    let title = "APPROVED BY CUSTOMER";
    let lead = "";
    let rows: [string, string][] = [];
    if (o.approval_method === "staff_recorded") {
      title = "APPROVAL RECORDED BY AMBIT";
      lead = "The customer approved this order outside the app. AMBIT recorded how.";
      rows = [
        ["Customer approval", o.approval_note ?? ""],
        ["Recorded by", `${o.approved_by_name ?? ""} (AMBIT)`],
        ["Recorded", dateTime(o.approved_at)],
      ];
    } else if (o.approval_method === "in_app" && o.placed_by_role === "customer") {
      title = "ORDER APPROVED";
      lead = `Placed and approved by the customer from their own AMBITION login, then sent to ${ORDERS_EMAIL}.`;
      rows = [
        ["Approved by", byCustomerName],
        ["How", "Approve order button in the app"],
        ["Approved", dateTime(o.approved_at)],
      ];
    } else if (o.approval_method === "in_app") {
      lead = `Approved by the customer in the AMBITION app, then sent to ${ORDERS_EMAIL}.`;
      rows = [
        ["Approved by", byCustomerName],
        ["How", "In the app, customer's own login"],
        ["Approved", dateTime(o.approved_at)],
      ];
    } else {
      lead = `Approved from the link AMBIT emailed the customer, then sent to ${ORDERS_EMAIL}.`;
      rows = [
        ["Approved by", byCustomerName],
        ["Sent to customer", dateTime(o.approval_sent_at)],
        ...(o.approval_email ? ([["Sent to", o.approval_email]] as [string, string][]) : []),
        ["Approved", `${dateTime(o.approved_at)} (email link)`],
      ];
    }
    if (o.approval_ref) rows.push(["Approval ref", o.approval_ref]);
    return (
      <View style={[s.box, { flex: 1.25, borderColor: GREEN }]}>
        <View style={s.h3}><Check color={GREEN} /><Text style={[s.h3t, { color: GREEN }]}>{title}</Text></View>
        <Text style={{ marginBottom: 4 }}>{lead}</Text>
        <Rec rows={rows} />
      </View>
    );
  }

  // Older orders (before approvals) and orders placed while approvals were off.
  return (
    <View style={[s.box, { flex: 1.25 }]}>
      <View style={s.h3}><Text style={s.h3t}>{doc.state === "cancelled" ? "ORDER CANCELLED" : "ORDER SUBMITTED"}</Text></View>
      <Rec
        rows={[
          ["Placed by", `${o.placed_by_name ?? o.placed_by_email ?? ""}${o.placed_by_role !== "customer" ? " (AMBIT)" : ""}`],
          ["Submitted", dateTime(o.created_at)],
        ]}
      />
    </View>
  );
}

function OrderPdf({ doc, approveUrl, qr }: { doc: OrderDoc; approveUrl: string | null; qr: string | null }) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const pickup = o.delivery_method === "pickup";
  const branchName = doc.branch ? `${doc.branch.name}, ${doc.branch.state}` : null;
  const waiting = awaitingCustomer(doc.state);

  const stamp =
    doc.state === "approved"
      ? { text: `APPROVED  ·  ${up(dateShort(o.approved_at))}`, color: GREEN }
      : doc.state === "pending"
        ? { text: "AWAITING CUSTOMER APPROVAL", color: AMBER }
        : doc.state === "changes_requested"
          ? { text: "CHANGES REQUESTED", color: AMBER }
          : doc.state === "expired"
            ? { text: "APPROVAL LINK EXPIRED", color: AMBER }
            : doc.state === "cancelled"
              ? { text: "CANCELLED", color: GRAY }
              : { text: `SUBMITTED  ·  ${up(dateShort(o.created_at))}`, color: GRAY };

  const c = doc.company;
  const customerLines = [c?.contact_name, c?.phone, c?.email].filter(Boolean) as string[];
  const shipLines = pickup
    ? ["AMBIT Polyurethane", doc.branch ? `${doc.branch.name} branch` : "", doc.branch?.address ?? ""].filter(Boolean)
    : (o.ship_address ?? "").split(/\r?\n/);

  const listed = doc.items.filter((i) => !i.customer_priced && i.line_total !== null);
  const acct = doc.items.filter((i) => i.customer_priced);
  const tbd = doc.items.filter((i) => !i.customer_priced && i.line_total === null);
  const subtotal = Number(o.est_subtotal ?? 0);

  const facts: [string, string, number][] = [
    ["ORDER DATE", dateShort(o.created_at), 1],
    ["CUSTOMER PO", o.po_number ?? "None", 1],
    ["NEEDED BY", o.needed_by ? dateShort(o.needed_by) : "Not set", 1.05],
    ["DELIVERY", pickup ? "Branch pickup" : o.delivery_method === "jobsite" ? "Job site" : "Drop ship", 1],
    ["SHIPS FROM", doc.branch?.name ?? (o.delivery_method === "dropship" ? "Supplier" : "AMBIT"), 1.05],
    ["PLACED BY", `${o.placed_by_name ?? o.placed_by_email ?? ""}${o.placed_by_role !== "customer" ? ", AMBIT" : ""}`, 1.45],
  ];

  return (
    <Document title={`AMBIT Order ${no}`} author="AMBIT Polyurethane" creator="AMBITION" producer="AMBITION" subject={`Order ${no} for ${o.company_name}`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.topbar} fixed />
        <Text style={s.cont} fixed render={({ pageNumber }) => (pageNumber > 1 ? `AMBIT ORDER ${no}  ·  ${up(o.company_name)}  ·  CONTINUED` : "")} />

        <View style={s.head}>
          <Image src={LOGO_PNG} style={s.logo} />
          <View style={s.ident}>
            <Text style={s.kicker}>AMBIT ORDER</Text>
            <Text style={s.h1}>{no}</Text>
            <Text style={[s.stamp, { color: stamp.color, borderColor: stamp.color }]}>{stamp.text}</Text>
          </View>
        </View>

        <View style={s.from}>
          <Text>
            <Text style={s.b}>AMBIT Polyurethane</Text>  ·  {AMBIT_PHONE}  ·  {ORDERS_EMAIL}  ·  www.AMBITPU.com
          </Text>
          {branchName ? (
            <Text>
              {pickup ? "Pickup at " : "Ships from "}
              <Text style={s.b}>{branchName}</Text>
            </Text>
          ) : null}
        </View>

        <View style={s.parties}>
          <View style={{ flex: 1.15, marginRight: 16 }}>
            <Label>Customer</Label>
            <Text style={s.name}>{o.company_name}</Text>
            {o.account_no ? <Text style={s.sub}>Account {o.account_no}</Text> : null}
            {customerLines.map((l) => <Text key={l}>{l}</Text>)}
          </View>
          <View style={{ flex: 1, marginRight: 16 }}>
            <Label>Bill to</Label>
            {c?.bill_address ? (
              <>
                <Text>{o.company_name}</Text>
                {c.bill_address.split(/\r?\n/).map((l, i) => <Text key={i}>{l}</Text>)}
              </>
            ) : (
              <Text style={s.sub}>Billing address on file at AMBIT</Text>
            )}
          </View>
          <View style={{ flex: 1.15 }}>
            <Label>{pickup ? "Pickup" : "Ship to"}</Label>
            <Text style={s.method}>{up(DELIVERY_LABEL[o.delivery_method] ?? o.delivery_method)}</Text>
            {shipLines.map((l, i) => <Text key={i}>{l}</Text>)}
          </View>
        </View>

        <View style={s.facts}>
          {facts.map(([k, v, f], i) => (
            <View key={k} style={[s.fact, { flex: f }, i ? { borderLeftWidth: 0.7, borderLeftColor: RULE } : {}]}>
              <Text style={s.factL}>{k}</Text>
              <Text style={s.factV}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={s.thead} fixed={false}>
          <Text style={[s.th, s.cN]}>#</Text>
          <Text style={[s.th, s.cSku]}>SKU</Text>
          <Text style={[s.th, s.cDesc]}>DESCRIPTION</Text>
          <Text style={[s.th, s.cQty]}>QTY</Text>
          <Text style={[s.th, s.cPrice]}>UNIT PRICE</Text>
          <Text style={[s.th, s.cAmt]}>AMOUNT</Text>
        </View>
        {doc.items.map((it, i) => (
          <View key={it.id ?? i} style={[s.tr, i % 2 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
            <Text style={[s.td, s.cN]}>{i + 1}</Text>
            <Text style={[s.td, s.cSku, s.skuText]}>{it.sku}</Text>
            <Text style={[s.td, s.cDesc, { fontFamily: "Helvetica-Bold" }]}>{it.name}</Text>
            <Text style={[s.td, s.cQty]}>{qtyText(Number(it.qty), it.unit)}</Text>
            {it.customer_priced ? (
              <>
                <Text style={[s.td, s.cPrice, s.acct]}>Account pricing</Text>
                <Text style={[s.td, s.cAmt, s.acct]}>On invoice</Text>
              </>
            ) : it.line_total === null ? (
              <>
                <Text style={[s.td, s.cPrice, s.acct]}>Price TBD</Text>
                <Text style={[s.td, s.cAmt, s.acct]}>On invoice</Text>
              </>
            ) : (
              <>
                <Text style={[s.td, s.cPrice]}>{money(it.unit_price)}</Text>
                <Text style={[s.td, s.cAmt]}>{money(it.line_total)}</Text>
              </>
            )}
          </View>
        ))}

        <View style={s.below} wrap={false}>
          <View style={s.notes}>
            <Label>Order notes</Label>
            {o.notes ? <Text>{o.notes}</Text> : <Text style={{ color: FAINT }}>No notes.</Text>}
            <Text style={s.fine}>
              Prices are AMBIT list prices when the order was placed. Spray foam and fiberglass are billed at the account&apos;s contract price.
              Final pricing, tax and freight are confirmed on the AMBIT invoice.
            </Text>
          </View>
          <View style={s.totals}>
            <View style={s.totRow}><Text>List-price items ({listed.length})</Text><Text style={s.b}>{money(subtotal)}</Text></View>
            {acct.length ? (
              <View style={s.totRow}><Text style={s.sub}>Account-priced items ({acct.length})</Text><Text style={s.sub}>Account pricing</Text></View>
            ) : null}
            {tbd.length ? (
              <View style={s.totRow}><Text style={s.sub}>Priced by AMBIT ({tbd.length})</Text><Text style={s.sub}>On invoice</Text></View>
            ) : null}
            <View style={s.totRow}><Text style={s.sub}>Tax and freight</Text><Text style={s.sub}>On invoice</Text></View>
            <View style={s.totGrand}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10 }}>Estimated subtotal</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10 }}>{money(subtotal)}{acct.length || tbd.length ? " +" : ""}</Text>
            </View>
          </View>
        </View>

        <View style={s.boxes} wrap={false}>
          <ApprovalBox doc={doc} approveUrl={approveUrl} qr={qr} />
          {waiting ? null : <OfficeBox pickup={pickup} />}
        </View>

        <View style={s.foot} fixed>
          <Text>AMBIT Polyurethane  ·  Order {no}  ·  Created in the AMBITION app {dateTime(o.created_at)}</Text>
        </View>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}

/** The order as a PDF. Pass the approval link for the copy the customer approves from. */
export async function renderOrderPdf(doc: OrderDoc, opts: { approveUrl?: string | null } = {}): Promise<Buffer> {
  const approveUrl = opts.approveUrl ?? null;
  const qr =
    approveUrl && doc.state === "pending"
      ? await QRCode.toDataURL(approveUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      : null;
  return renderToBuffer(<OrderPdf doc={doc} approveUrl={approveUrl} qr={qr} />);
}

export const pdfFileName = (doc: OrderDoc) => `AMBIT-Order-${orderNo(doc.order.order_no)}.pdf`;
