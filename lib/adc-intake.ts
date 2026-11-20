import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { siteUrl } from "@/lib/env";
import { todayCentral } from "@/lib/sale";
import { findExisting, nearestBranch, planOrder, verifyCustomer, type Co, type Delivery, type Site, type Strategy } from "@/lib/adc-logistics";

// What happens right after an ADC web order is saved: who the customer is (an AMBIT account we can confirm, someone
// who says they are, or someone new we add to A.I.), the Best Strategy for getting it to them, the alerts for the order
// desk, and a note on the customer's page in A.I.

export type Addr = { street: string; street2?: string; city: string; state: string; zip: string };
export type IntakeIn = {
  id: number;
  order_no: string;
  subtotal: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  delivery: Delivery;
  pickup_branch: string;
  address: Addr;
  kind: "account" | "new";
  check: string;
  bill: Addr | null;
  tax_exempt: boolean;
  site: Site;
  lines: { product_id: string | null; sku: string; name: string; qty: number }[];
};
export type Intake = {
  match: "verified" | "unverified" | "new" | "added";
  company: { id: string; name: string; account_no: string | null } | null;
  red: string[];
  alerts: string[];
  strategy: Strategy | null;
  estimate: number | null;
};

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const addrText = (a: Addr | null) => (a ? `${a.street}${a.street2 ? `, ${a.street2}` : ""}, ${a.city}, ${a.state.toUpperCase()} ${a.zip}` : "");

/** The shipping estimate the checkout shows (no order yet). */
export async function estimateFor(q: { lines: { product_id: string | null; sku: string; name: string; qty: number }[]; delivery: Delivery; zip: string; site: Site; pickup_branch?: string | null }) {
  if (!serviceReady()) return null;
  return planOrder(serviceClient(), { lines: q.lines, delivery: q.delivery, zip: q.zip, pickup_branch: q.pickup_branch ?? null, site: q.site });
}

export async function intakeAdcOrder(o: IntakeIn): Promise<Intake> {
  if (!serviceReady()) {
    return { match: "new", company: null, red: ["Check this customer by hand: the app couldn't reach the customer list."], alerts: [], strategy: null, estimate: null };
  }
  const db = serviceClient();
  const red: string[] = [];
  const alerts: string[] = [];
  let match: Intake["match"] = "new";
  let co: Co | null = null;
  const bill = o.bill ?? (o.delivery === "pickup" ? null : o.address);

  // ---------------------------------------------------------------- who is it
  if (o.kind === "account") {
    co = await verifyCustomer(db, o.company, o.check, o.email);
    if (co) match = "verified";
    else {
      match = "unverified";
      const maybe = await findExisting(db, o.company, o.email, o.phone);
      if (maybe) co = maybe.co;
      red.push(
        `SAYS THEY'RE AN AMBIT CUSTOMER, BUT IT DIDN'T MATCH: "${o.company}" with "${o.check}"${maybe ? ` (closest: ${maybe.co.name})` : ""}. Call them to confirm the account before using their terms. Until then, treat it as prepay.`,
      );
    }
  } else {
    const ex = await findExisting(db, o.company, o.email, o.phone);
    if (ex) {
      co = ex.co;
      match = "unverified";
      red.push(`CHECKED "NEW CUSTOMER", BUT LOOKS LIKE ${ex.co.name.toUpperCase()} (${ex.strong ? "same email or phone" : "same name"}). Confirm it's them before using their terms. Until then, treat it as prepay.`);
    } else {
      const branch = await nearestBranch(db, (bill ?? o.address).zip);
      const row = {
        name: o.company.slice(0, 160),
        contact_name: o.name.slice(0, 120),
        phone: o.phone.slice(0, 40),
        email: o.email.slice(0, 160),
        city: (bill ?? o.address).city || null,
        state: (bill ?? o.address).state ? (bill ?? o.address).state.toUpperCase() : null,
        bill_address: addrText(bill) || null,
        ship_address: o.delivery === "pickup" ? null : addrText(o.address),
        default_branch_id: branch,
        source: "adc",
        needs_qb_setup: true,
        credit_status: "advance",
        notes: `Added from ADC web order ${o.order_no}.${o.tax_exempt ? " Says they're tax exempt: get their certificate." : ""}`,
      };
      let ins = await db.from("companies").insert(row).select("id, name, account_no, phone, email, credit_status, credit_limit, ar_balance, pay_cod, terms, active").single();
      // Before update 0100 the 'adc' source isn't allowed yet.
      if (ins.error) ins = await db.from("companies").insert({ ...row, source: "app" }).select("id, name, account_no, phone, email, credit_status, credit_limit, ar_balance, pay_cod, terms, active").single();
      if (!ins.error && ins.data) {
        co = ins.data as Co;
        match = "added";
      } else {
        red.push(`Couldn't add them to A.I. as a customer (${ins.error?.message ?? "unknown"}). Add them by hand.`);
      }
    }
  }
  if (match !== "verified") {
    red.push("NEW / PREPAY CUSTOMER: 1) Confirm the shipping cost. 2) Add them to QuickBooks. 3) Send the invoice. 4) Don't ship until it's paid.");
  } else if (co) {
    if (co.pay_cod || co.credit_status === "advance" || co.credit_status === "revoked" || co.credit_status === "review") {
      red.push(`${co.name} ${co.credit_status === "revoked" ? "has its credit line revoked" : co.credit_status === "review" ? "is on credit review" : "pays in advance"}: invoice it and get paid before it ships.`);
    }
    const owed = Number(co.ar_balance ?? 0);
    if (co.credit_limit !== null && co.credit_limit !== undefined && owed + o.subtotal > Number(co.credit_limit)) {
      red.push(`Over the credit line: owes ${usd(owed)} + this order ${usd(o.subtotal)} is more than the ${usd(Number(co.credit_limit))} line.`);
    }
  }
  if (o.tax_exempt) alerts.push("Says they're tax exempt: get their certificate before invoicing without tax.");

  // ---------------------------------------------------------------- how to get it there
  let strategy: Strategy | null = null;
  try {
    strategy = await planOrder(db, { lines: o.lines, delivery: o.delivery, zip: o.address.zip, pickup_branch: o.pickup_branch, site: o.site });
  } catch (e) {
    alerts.push(`The Best Strategy didn't work out (${(e as Error).message}). Plan the shipping by hand.`);
  }
  if (strategy) {
    if (strategy.vendor.length) alerts.push(`Needs a vendor order: ${strategy.vendor.map((v) => `${v.qty} x ${v.sku}`).join(", ")}.`);
    if (strategy.partial && o.delivery !== "pickup") alerts.push("The shipping estimate leaves some items out: confirm those by hand.");
    const best = strategy.options.find((x) => x.key === strategy!.best);
    if (best?.transfers.length) alerts.push(`Needs a transfer between locations first: ${best.transfers.map((t) => `${t.qty} x ${t.sku} ${t.fromName} → ${t.toName}`).join(", ")}.`);
  }
  const estimate = strategy?.estimate ?? null;

  // ---------------------------------------------------------------- save it on the web order
  const upd = await db
    .from("adc_orders")
    .update({
      customer_kind: o.kind,
      account_check: o.check || null,
      company_id: co?.id ?? null,
      match,
      bill_address: bill,
      tax_exempt: o.tax_exempt,
      site: o.site.site,
      unload: o.site.unload,
      ship_est: estimate,
      strategy,
      alerts: [...red, ...alerts],
    })
    .eq("id", o.id);
  if (upd.error) console.error("adc intake: saving the order details failed", upd.error.message);

  // ---------------------------------------------------------------- a note on the customer's page (the CRM)
  if (co) {
    const best = strategy?.options.find((x) => x.key === strategy!.best);
    const body = [
      `ADC web order ${o.order_no}: ${usd(o.subtotal)}${o.delivery === "pickup" ? " (pick up)" : ""}.`,
      best ? `Best Strategy: ${best.title}${estimate !== null && o.delivery !== "pickup" ? `, estimated shipping ${usd(estimate)}` : ""}.` : "",
      red.length ? `ACTION: ${match === "verified" ? red[0] : "add to QuickBooks, send the invoice, ship after it's paid."}` : "",
      `Sheet: ${siteUrl()}/orders/web/${o.id}/strategy`,
    ]
      .filter(Boolean)
      .join(" ");
    const note = await db.from("collection_notes").insert({ company_id: co.id, kind: "note", body: body.slice(0, 2000), follow_up_on: red.length ? todayCentral() : null, by_name: "ADC Web Store" });
    if (note.error) console.error("adc intake: the customer note failed", note.error.message);
  }

  return { match, company: co ? { id: co.id, name: co.name, account_no: co.account_no } : null, red, alerts, strategy, estimate };
}
