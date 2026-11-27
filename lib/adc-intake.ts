import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { siteUrl } from "@/lib/env";
import { todayCentral } from "@/lib/sale";
import { msrpRealPrices } from "@/lib/adc-my-prices";
import { findExisting, matchCustomerByName, nearestBranch, planOrder, type Co, type Delivery, type Site, type Strategy } from "@/lib/adc-logistics";

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

/** Ship-to farther than this from every AMBIT location gets the red alert (a real freight quote first). */
const FAR_MILES = 600;
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
    // Matched by business name only (customers rarely know their account #): staff double-check every one.
    const m = await matchCustomerByName(db, o.company);
    if (m.co) {
      co = m.co;
      match = "verified";
      alerts.unshift(
        `DOUBLE-CHECK THE CUSTOMER: "${o.company}" was matched to ${m.co.name}${m.co.account_no ? ` (acct ${m.co.account_no})` : ""} by business name only. Confirm it's them (phone or email on file) before using their terms.${m.others.length ? ` Other close names: ${m.others.map((x) => x.name).join(", ")}.` : ""}`,
      );
    } else {
      match = "unverified";
      const maybe = await findExisting(db, o.company, o.email, o.phone);
      if (maybe) co = maybe.co;
      const close = [...new Set([...(maybe ? [maybe.co.name] : []), ...m.others.map((x) => x.name)])];
      red.push(
        `SAYS THEY'RE AN AMBIT CUSTOMER, BUT "${o.company}" DIDN'T MATCH ONE ACCOUNT${close.length ? ` (close: ${close.join(", ")})` : ""}. Find the right account and confirm with them before using their terms. Until then, treat it as prepay.`,
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

  // ---------------------------------------------------------------- how to get it there
  let strategy: Strategy | null = null;
  try {
    strategy = await planOrder(db, { lines: o.lines, delivery: o.delivery, zip: o.address.zip, pickup_branch: o.pickup_branch, site: o.site });
  } catch (e) {
    alerts.push(`The Best Strategy didn't work out (${(e as Error).message}). Plan the shipping by hand.`);
  }
  if (o.delivery !== "pickup" && o.site.site === "home") {
    red.push("HOME DELIVERY: confirm a freight truck can get there and someone can receive it (residential and liftgate fees apply).");
  }
  if (strategy) {
    if (strategy.vendor.length) {
      red.push(`NEEDS A VENDOR ORDER: ${strategy.vendor.map((v) => `${v.qty} x ${v.sku}${v.vendor ? ` from ${v.vendor}` : ""}${v.lead ? ` (${v.lead} days)` : ""}`).join(", ")}. Place it and confirm the timing with the customer.`);
    }
    if (o.delivery !== "pickup" && strategy.nearest && strategy.nearest.miles > FAR_MILES) {
      red.push(`FAR FROM EVERY LOCATION: ${strategy.nearest.miles.toLocaleString("en-US")} road miles from the closest (${strategy.nearest.name}). Get a real freight quote before confirming the price.`);
    }
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

// ---------------------------------------------------------------- prices by who the customer is

export type PricedLine = {
  product_id?: string | null; sku: string; name: string; unit: string | null; qty: number; price: number | null;
  list_price?: number | null; on_sale?: boolean; promo?: string | null; set?: boolean; ship?: string;
};

/**
 * The store shows sale items only 5% under the normal price. A current AMBIT customer (matched to an account) gets
 * the full sale price on everything but spray foam, and the spray foam sale (per lb off) is theirs only: anyone else's
 * foam lines lose that note. Saves the new lines and subtotal on the web order; null when nothing changed.
 */
export async function priceForCustomer(o: { id: number; lines: PricedLine[]; ambitCustomer: boolean; companyId?: string | null; userId?: string | null }): Promise<{ lines: PricedLine[]; subtotal: number; has_quote: boolean } | null> {
  if (!serviceReady()) return null;
  const db = serviceClient();
  const ids = [...new Set(o.lines.map((l) => l.product_id).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return null;
  const [{ data: saleRows }, { data: prods }, { data: msrpCats }] = await Promise.all([
    db.rpc("adc_sale"),
    db.from("products").select("id, category_id").in("id", ids),
    db.from("categories").select("id").eq("adc_msrp", true),
  ]);
  const sale = ((saleRows ?? []) as { slug: string; name: string }[])[0] ?? null;
  const foam = new Set(((prods ?? []) as { id: string; category_id: string | null }[]).filter((p) => p.category_id === "ambit-foam").map((p) => p.id));
  // Guns & parts stay at MSRP on the web order (Graco and Binks): the order desk sets the real price in A.I. (0105).
  const mc = new Set(((msrpCats ?? []) as { id: string }[]).map((c) => c.id));
  const msrp = new Set(((prods ?? []) as { id: string; category_id: string | null }[]).filter((p) => p.category_id && mc.has(p.category_id)).map((p) => p.id));
  // Graco and Binks parts: the public store shows MSRP, but the order gets the real price (our price, the sale price
  // or the customer's own), like the signed-in cart showed. The AMBIT account: the verified match, else the shopper's own link.
  let companyId = o.ambitCustomer ? o.companyId ?? null : null;
  if (!companyId && o.userId) {
    const { data: me } = await db.from("profiles").select("company_id").eq("id", o.userId).maybeSingle();
    companyId = (me as { company_id: string | null } | null)?.company_id ?? null;
  }
  const real = msrp.size ? await msrpRealPrices({ companyId, productIds: [...msrp] }) : new Map<string, { price: number; sale: boolean }>();
  const full = new Map<string, number>();
  if (sale && o.ambitCustomer) {
    const { data: s } = await db.from("web_sales").select("id").eq("slug", sale.slug).maybeSingle();
    if (s) {
      const { data: items } = await db.from("web_sale_items").select("product_id, price").eq("sale_id", (s as { id: string }).id).in("product_id", ids).not("price", "is", null);
      for (const i of (items ?? []) as { product_id: string; price: number }[]) full.set(i.product_id, Number(i.price));
    }
  }
  let changed = false;
  const lines = o.lines.map((l) => {
    if (!l.product_id) return l;
    if (foam.has(l.product_id)) {
      if (!l.promo) return l;
      changed = true;
      return o.ambitCustomer ? { ...l, promo: `AMBIT customer ${l.promo}` } : { ...l, promo: null };
    }
    if (msrp.has(l.product_id)) {
      const r = real.get(l.product_id);
      if (!r || (l.price !== null && r.price >= l.price)) return l;
      changed = true;
      return { ...l, price: r.price, on_sale: r.sale, promo: r.sale ? `${sale?.name ?? "Sale"} price (MSRP ${l.price === null ? "-" : `$${l.price.toFixed(2)}`})` : `Your price (MSRP ${l.price === null ? "-" : `$${l.price.toFixed(2)}`})` };
    }
    const f = full.get(l.product_id);
    if (f === undefined || (l.price !== null && f >= l.price)) return l;
    changed = true;
    return { ...l, price: f, on_sale: true, promo: `AMBIT customer ${sale?.name ?? "sale"} price` };
  });
  if (!changed) return null;
  const subtotal = Math.round(lines.reduce((t, l) => t + (l.price ?? 0) * l.qty, 0) * 100) / 100;
  const has_quote = lines.some((l) => l.price === null);
  const { error } = await db.from("adc_orders").update({ items: lines, subtotal, has_quote }).eq("id", o.id);
  if (error) {
    console.error("adc pricing: saving the customer prices failed", error.message);
    return null;
  }
  return { lines, subtotal, has_quote };
}
