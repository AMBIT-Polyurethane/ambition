import "server-only";
import { Document, Font, Image, Page, Path, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { DELIVERY_LABEL, dateShort, dateTime, orderNo, plural, qtyText } from "@/lib/format";
import { LOGO_ASPECT, LOGO_PNG } from "@/lib/order-doc/logo";
import { awaitingCustomer, type OrderDoc } from "@/lib/order-doc/types";
import { foamLoads, foamSide, pickText, splitNote } from "@/lib/order-doc/loads";

// The packing slip: the warehouse's copy for picking and loading an order. The items, quantities, the lots the app
// picked, the Sales Order # and Invoice #, and no prices. Signed by the AMBIT employee who loads it and by the
// customer or trucker who takes it. Same look as the printed order (lib/order-doc/pdf.tsx).

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

/** The stop rule, word for word as the team wrote it (Nov 17, 2026). */
export const STOP_TEXT =
  "STOP. IF THERE ARE ANY ITEMS BEING LOADED THAT ARE NOT ON THIS PACKING SLIP YOU MUST FIRST OBTAIN AN UPDATED PACKING SLIP AND VERIFY THAT THESE NEW ITEMS ARE ON THE INVOICE. DO NOT LOAD ANY ITEMS THAT ARE NOT ON THIS FORM.";

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 50, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 8.6, color: INK },
  topbar: { position: "absolute", top: 0, left: 0, right: 0, height: 6.5, backgroundColor: RED },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { width: 140, height: 140 * LOGO_ASPECT },
  ident: { alignItems: "flex-end" },
  kicker: { fontFamily: "Helvetica-Bold", fontSize: 7.4, letterSpacing: 1.3, color: RED },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 20, marginTop: 2, marginBottom: 5, lineHeight: 1.05 },
  stamp: { borderWidth: 1.2, borderRadius: 3, paddingVertical: 2.5, paddingHorizontal: 7, fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 0.7 },
  copyTag: { fontSize: 7, letterSpacing: 0.8, color: "#B42318", fontFamily: "Helvetica-Bold", marginTop: 4, textAlign: "right" },
  from: { flexDirection: "row", justifyContent: "space-between", marginTop: 11, paddingBottom: 5, borderBottomWidth: 2, borderBottomColor: INK, fontSize: 7.4, lineHeight: 1.35, color: GRAY },
  b: { fontFamily: "Helvetica-Bold", color: INK },
  // Sales Order #, Invoice #: the two numbers the warehouse checks first.
  nums: { flexDirection: "row", marginTop: 10, borderWidth: 1.2, borderColor: INK, borderRadius: 3 },
  num: { flex: 1, paddingVertical: 5, paddingHorizontal: 8 },
  numL: { fontFamily: "Helvetica-Bold", fontSize: 6.4, letterSpacing: 0.9, color: GRAY },
  numV: { fontFamily: "Helvetica-Bold", fontSize: 13, marginTop: 1.5, lineHeight: 1.1 },
  numMissing: { fontFamily: "Helvetica-Bold", fontSize: 9.5, marginTop: 3.5, lineHeight: 1.1, color: RED },
  warn: { flexDirection: "row", alignItems: "center", marginTop: 6, backgroundColor: RED, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 9 },
  warnT: { fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 1, color: "#FFFFFF" },
  warnS: { flex: 1, marginLeft: 12, fontSize: 7.4, lineHeight: 1.35, color: "#FFFFFF" },
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
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 5.5, borderBottomWidth: 0.7, borderBottomColor: RULE, fontSize: 8.6, lineHeight: 1.35 },
  td: { paddingHorizontal: 5 },
  cN: { width: 20, textAlign: "right", color: FAINT },
  cSku: { width: 78 },
  skuText: { fontSize: 7.6, color: GRAY },
  cDesc: { flex: 1 },
  cQty: { width: 62, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 10 },
  cTick: { width: 46, alignItems: "center" },
  tick: { width: 13, height: 13, borderWidth: 1.1, borderColor: INK, borderRadius: 1.5 },
  loadBreak: { borderTopWidth: 1.8, borderTopColor: INK },
  splitNote: { fontSize: 7, color: GRAY, marginTop: 1 },
  pick: { fontSize: 8, color: INK, marginTop: 1.5 },
  pickQ: { fontFamily: "Helvetica-Bold" },
  total: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, fontSize: 8.6, lineHeight: 1.35 },
  lotRule: { marginTop: 7, borderWidth: 1.2, borderColor: INK, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 9, fontSize: 8.4, lineHeight: 1.35 },
  notes: { marginTop: 11, fontSize: 8.6, lineHeight: 1.35 },
  stop: { flexDirection: "row", alignItems: "center", marginTop: 12, borderWidth: 2, borderColor: RED, borderRadius: 4, paddingVertical: 7, paddingHorizontal: 10 },
  stopText: { flex: 1, marginLeft: 12, fontFamily: "Helvetica-Bold", fontSize: 9.4, lineHeight: 1.35, color: RED },
  boxes: { flexDirection: "row", marginTop: 10, fontSize: 8.6, lineHeight: 1.35 },
  box: { flex: 1, borderWidth: 1.1, borderColor: INK, borderRadius: 3, paddingVertical: 8, paddingHorizontal: 10 },
  h3t: { fontFamily: "Helvetica-Bold", fontSize: 7.8, letterSpacing: 0.9, marginBottom: 3 },
  attest: { fontSize: 7.4, lineHeight: 1.35, color: GRAY, marginBottom: 2 },
  line: { flexDirection: "row", alignItems: "flex-end", marginTop: 11 },
  lineL: { fontSize: 7.4, color: GRAY, marginRight: 5 },
  lineRule: { flex: 1, borderBottomWidth: 0.8, borderBottomColor: INK, height: 12 },
  foot: { position: "absolute", left: 36, right: 36, bottom: 20, borderTopWidth: 0.7, borderTopColor: RULE, paddingTop: 4, fontSize: 6.6, color: GRAY },
  cont: { position: "absolute", left: 36, right: 36, top: 15, fontSize: 6.6, color: GRAY, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 },
  pageNo: { position: "absolute", left: 36, right: 36, bottom: 20, paddingTop: 4.7, fontSize: 6.6, color: GRAY, textAlign: "right" },
});

const up = (t: string) => t.toUpperCase();

function Label({ children }: { children: string }) {
  return <Text style={s.lbl}>{up(children)}</Text>;
}

/** A red octagon with STOP on it. */
function StopSign({ size = 64 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path d="M29.3 0 L70.7 0 L100 29.3 L100 70.7 L70.7 100 L29.3 100 L0 70.7 L0 29.3 Z" fill={RED} />
        <Path d="M31.4 5 L68.6 5 L95 31.4 L95 68.6 L68.6 95 L31.4 95 L5 68.6 L5 31.4 Z" fill="none" stroke="#FFFFFF" strokeWidth={3} />
      </Svg>
      <Text
        style={{ position: "absolute", left: 0, right: 0, top: size * 0.36, textAlign: "center", fontFamily: "Helvetica-Bold", fontSize: size * 0.26, lineHeight: 1, color: "#FFFFFF", letterSpacing: 0.5 }}
      >
        STOP
      </Text>
    </View>
  );
}

function Line({ label }: { label: string }) {
  return (
    <View style={s.line}>
      <Text style={s.lineL}>{label}</Text>
      <View style={s.lineRule} />
    </View>
  );
}

function Two({ a, b }: { a: string; b: string }) {
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ flex: 1.3, marginRight: 10 }}><Line label={a} /></View>
      <View style={{ flex: 1 }}><Line label={b} /></View>
    </View>
  );
}

/** "38 drums · 2 pails · 1 each" for everything on the slip. */
export function totalsText(items: { qty: number | string; unit: string }[]): string {
  const by = new Map<string, number>();
  for (const i of items) {
    const u = (i.unit || "each").toLowerCase().replace(/s$/, "");
    by.set(u, (by.get(u) ?? 0) + Number(i.qty));
  }
  return [...by.entries()].map(([u, q]) => qtyText(q, u)).join("  ·  ");
}

function PackingSlip({ doc, printedBy, printedAt }: { doc: OrderDoc; printedBy: string | null; printedAt: string }) {
  const o = doc.order;
  const no = orderNo(o.order_no);
  const pickup = o.delivery_method === "pickup";
  const rev = (o as { revision?: number }).revision ?? 1;
  const branchName = doc.branch ? `${doc.branch.name}, ${doc.branch.state}` : null;

  const c = doc.company;
  const customerLines = [c?.contact_name, c?.phone].filter(Boolean) as string[];
  const shipLines = pickup
    ? ["AMBIT Polyurethane", doc.branch ? `${doc.branch.name} branch` : "", doc.branch?.address ?? ""].filter(Boolean)
    : (o.ship_address ?? "").split(/\r?\n/);

  const groups = foamLoads(doc.items);
  let counter = 0;
  const rows = groups.flatMap((g, gi) => g.rows.map((row, ri) => ({ row, it: row.item, n: ++counter, first: gi > 0 && ri === 0 })));
  const hasLots = doc.items.some((it) => Boolean(it.picks?.length) || foamSide(it) !== null);

  // Reasons not to load yet, most serious first.
  const waiting = awaitingCustomer(doc.state);
  const missing = [!o.ambit_po ? "Sales Order #" : null, !o.invoice_no ? "Invoice #" : null].filter(Boolean) as string[];
  const hold = o.credit_status === "hold";

  const when = o.scheduled_for ? dateShort(o.scheduled_for) : null;
  const stamp = doc.state === "cancelled"
    ? { text: "CANCELLED · DO NOT LOAD", color: RED }
    : when
      ? { text: `${pickup ? "PICKUP" : "DELIVERY"}  ·  ${up(when)}`, color: GREEN }
      : { text: `${pickup ? "PICKUP" : "DELIVERY"} NOT SCHEDULED YET`, color: AMBER };

  const facts: [string, string, number][] = [
    ["ORDER DATE", dateShort(o.created_at), 1],
    ["NEEDED BY", o.needed_by ? dateShort(o.needed_by) : "Not set", 1],
    [pickup ? "PICKUP DATE" : "DELIVERY DATE", when ?? "Not scheduled", 1.05],
    ["SHIPS FROM", doc.branch?.name ?? "AMBIT", 1],
    ["PLACED BY", `${o.placed_by_name ?? o.placed_by_email ?? ""}${o.placed_by_role !== "customer" ? ", AMBIT" : ""}`, 1.5],
  ];

  const numbers: [string, string | null][] = [
    ["SALES ORDER #", o.ambit_po ?? null],
    ["INVOICE #", o.invoice_no ?? null],
    ["CUSTOMER PO", o.po_number ?? "None"],
    ["AMBIT ORDER", no],
  ];

  return (
    <Document title={`AMBIT Packing Slip ${no}`} author="AMBIT Polyurethane" creator="AMBIT Intelligence" producer="AMBIT Intelligence" subject={`Packing slip for order ${no}, ${o.company_name}`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.topbar} fixed />
        <Text style={s.cont} fixed render={({ pageNumber }) => (pageNumber > 1 ? `PACKING SLIP ${no}  ·  ${up(o.company_name)}  ·  CONTINUED` : "")} />

        <View style={s.head}>
          <Image src={LOGO_PNG} style={s.logo} />
          <View style={s.ident}>
            <Text style={s.kicker}>{rev > 1 ? `PACKING SLIP  ·  REVISION ${rev}` : "PACKING SLIP"}</Text>
            <Text style={s.h1}>{no}</Text>
            <Text style={[s.stamp, { color: stamp.color, borderColor: stamp.color }]}>{stamp.text}</Text>
            <Text style={s.copyTag}>WAREHOUSE PICKING COPY  ·  NO PRICES</Text>
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

        <View style={s.nums}>
          {numbers.map(([k, v], i) => (
            <View key={k} style={[s.num, i ? { borderLeftWidth: 0.7, borderLeftColor: RULE } : {}]}>
              <Text style={s.numL}>{k}</Text>
              {v ? <Text style={s.numV}>{v}</Text> : <Text style={s.numMissing}>NOT ENTERED YET</Text>}
            </View>
          ))}
        </View>

        {doc.state === "cancelled" ? (
          <View style={s.warn}>
            <Text style={s.warnT}>ORDER CANCELLED</Text>
            <Text style={s.warnS}>Do not load anything on this packing slip.</Text>
          </View>
        ) : waiting ? (
          <View style={s.warn}>
            <Text style={s.warnT}>NOT APPROVED YET</Text>
            <Text style={s.warnS}>The customer hasn&apos;t approved this order. Do not load it.</Text>
          </View>
        ) : hold ? (
          <View style={s.warn}>
            <Text style={s.warnT}>CREDIT HOLD</Text>
            <Text style={s.warnS}>Accounting has this order on hold. Do not release it until they clear it.</Text>
          </View>
        ) : missing.length ? (
          <View style={s.warn}>
            <Text style={s.warnT}>NOT READY TO LOAD</Text>
            <Text style={s.warnS}>
              No {missing.join(" or ")} yet. Get a packing slip that shows {missing.length > 1 ? "both numbers" : "it"} from the order desk before you load.
            </Text>
          </View>
        ) : null}
        {o.pay_prepaid ? (
          <View style={[s.warn, { backgroundColor: GREEN }]}>
            <Text style={s.warnT}>CUSTOMER HAS ALREADY PAID</Text>
            <Text style={s.warnS}>Paid in full. Nothing to collect at pickup or delivery.</Text>
          </View>
        ) : o.pay_cod || o.pay_no_checks ? (
          <View style={s.warn}>
            <Text style={s.warnT}>{[o.pay_cod ? "COD ONLY" : "", o.pay_no_checks ? "NO CHECKS ALLOWED" : ""].filter(Boolean).join("  ·  ")}</Text>
            <Text style={s.warnS}>
              {o.pay_cod ? "Collect payment before the order is released. " : ""}
              {o.pay_no_checks ? "Do not accept a check: cash or card only." : ""}
            </Text>
          </View>
        ) : null}

        <View style={s.parties}>
          <View style={{ flex: 1.15, marginRight: 16 }}>
            <Label>Customer</Label>
            <Text style={s.name}>{o.company_name}</Text>
            {o.account_no ? <Text style={s.sub}>Account {o.account_no}</Text> : null}
            {customerLines.map((l) => <Text key={l}>{l}</Text>)}
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

        <View style={s.thead}>
          <Text style={[s.th, s.cN]}>#</Text>
          <Text style={[s.th, s.cSku]}>SKU</Text>
          <Text style={[s.th, s.cDesc]}>ITEM  ·  LOT TO LOAD</Text>
          <Text style={[s.th, s.cQty, { fontSize: 6.4 }]}>QTY</Text>
          <Text style={[s.th, s.cTick, { textAlign: "center" }]}>LOADED</Text>
        </View>
        {rows.map(({ row, n, first, it }) => (
          <View key={`${it.id ?? n}-${n}`} style={[s.tr, n % 2 === 0 ? { backgroundColor: ZEBRA } : {}, first ? s.loadBreak : {}]} wrap={false}>
            <Text style={[s.td, s.cN]}>{n}</Text>
            <Text style={[s.td, s.cSku, s.skuText]}>{it.sku}</Text>
            <View style={[s.td, s.cDesc]}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{it.name}</Text>
              {splitNote(row, plural(it.unit, 2)) ? <Text style={s.splitNote}>{splitNote(row, plural(it.unit, 2))}</Text> : null}
              {(row.picks ?? []).map((p, k) => (
                <Text key={k} style={s.pick}>
                  <Text style={s.pickQ}>{qtyText(p.qty, it.unit)}</Text>  {pickText(p)}
                </Text>
              ))}
            </View>
            <Text style={[s.td, s.cQty]}>{qtyText(row.qty, it.unit)}</Text>
            <View style={[s.td, s.cTick]}><View style={s.tick} /></View>
          </View>
        ))}
        <View style={s.total} wrap={false}>
          <Text>
            <Text style={s.b}>Total to load: </Text>
            {totalsText(doc.items)}
          </Text>
          <Text style={s.sub}>{doc.items.length} {doc.items.length === 1 ? "line" : "lines"}</Text>
        </View>
        {hasLots ? (
          <View style={s.lotRule} wrap={false}>
            <Text>
              <Text style={s.b}>Load only the lots printed above. </Text>
              If a drum&apos;s lot # is different, stop: the order has to be changed in the app and a new packing slip printed before it is loaded. Nothing is written in by hand.
            </Text>
          </View>
        ) : null}

        {o.notes ? (
          <View style={s.notes} wrap={false}>
            <Label>Order notes</Label>
            <Text>{o.notes}</Text>
          </View>
        ) : null}

        <View wrap={false}>
          <View style={s.stop}>
            <StopSign size={58} />
            <Text style={s.stopText}>{STOP_TEXT}</Text>
          </View>
          <View style={s.boxes}>
            <View style={[s.box, { marginRight: 14, borderColor: RED, borderWidth: 1.6 }]}>
              <Text style={[s.h3t, { color: RED }]}>AMBIT EMPLOYEE · PICKED AND LOADED BY</Text>
              <Text style={s.attest}>
                I loaded only the items, quantities and lots printed on this packing slip, and I checked the lot # on every drum.
              </Text>
              <Line label="Print name" />
              <Line label="Signature" />
              <Two a="Date" b="Time" />
            </View>
            <View style={s.box}>
              <Text style={s.h3t}>{pickup ? "CUSTOMER OR TRUCK DRIVER · PICKED UP BY" : "TRUCK DRIVER · RECEIVED FOR DELIVERY BY"}</Text>
              <Text style={s.attest}>I received the items and quantities on this packing slip.</Text>
              <Line label="Print name" />
              <Line label="Company / carrier" />
              <Line label="Signature" />
              <Two a="Date" b="Truck / trailer #" />
            </View>
          </View>
        </View>

        <View style={s.foot} fixed>
          <Text>
            AMBIT Polyurethane  ·  Packing slip {no}{rev > 1 ? ` (revision ${rev})` : ""}  ·  Printed {dateTime(printedAt)}{printedBy ? ` by ${printedBy}` : ""}  ·  Only the newest packing slip counts
          </Text>
        </View>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}

/** The packing slip as a PDF (AMBIT staff only: it shows the lots the app picked). */
export async function renderPackingSlip(doc: OrderDoc, opts: { printedBy?: string | null; printedAt?: string } = {}): Promise<Buffer> {
  return renderToBuffer(<PackingSlip doc={doc} printedBy={opts.printedBy ?? null} printedAt={opts.printedAt ?? new Date().toISOString()} />);
}

export const packingSlipFileName = (doc: OrderDoc) => `AMBIT-Packing-Slip-${orderNo(doc.order.order_no)}.pdf`;
