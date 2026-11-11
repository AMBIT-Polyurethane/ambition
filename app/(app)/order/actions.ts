"use server";

import { revalidatePath } from "next/cache";
import { getSession, isEmployee } from "@/lib/session";
import { approvalsEnabled, creditEmailList, sendApprovalRequest, sendOrderEmail } from "@/lib/order-send";
import { can } from "@/lib/access";
import { sendEmail, wrapEmail } from "@/lib/email";
import { ACCOUNTING_EMAIL } from "@/lib/env";
import { currentOrigin } from "@/lib/origin";
import { escapeHtml as h } from "@/lib/format";
import { ORDER_CUSTOMER_COLUMNS, type OrderCustomer } from "@/lib/customers";
import { kickSync } from "@/lib/inventory/sync";
import { carriedAt } from "@/lib/inventory/carried";
import { serviceClient, serviceReady } from "@/lib/supabase/service";

export type NewCustomerInput = {
  name: string;
  contact: string;
  phone: string;
  email: string;
  billAddress: string;
  shipAddress: string; // blank = same as billing
  branchId: string;
};
export type NewCustomerResult = { ok: true; customer: OrderCustomer; message: string; existing?: boolean } | { ok: false; error: string };

const clip = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

/** AMBIT staff add a customer from the order screen. Usable right away; accounting is emailed to set it up in QuickBooks. */
/** Staff picked a customer on the order screen: their address, email and phone (the list itself is kept short). */
export async function customerDetails(id: string): Promise<OrderCustomer | null> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await s.supabase.from("companies").select(ORDER_CUSTOMER_COLUMNS).eq("id", id).maybeSingle();
  return (data as OrderCustomer | null) ?? null;
}

/** Staff picked a customer on the order screen: who gets credit for their orders (prefills the Sales rep box). */
export async function customerRep(id: string): Promise<{ rep: string | null; house: boolean } | null> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await s.supabase.from("companies").select("sales_rep_id, house_account").eq("id", id).maybeSingle<{ sales_rep_id: string | null; house_account: boolean | null }>();
  if (error) {
    // Update 0060 not run yet: no House Account column.
    const { data: old } = await s.supabase.from("companies").select("sales_rep_id").eq("id", id).maybeSingle<{ sales_rep_id: string | null }>();
    return { rep: old?.sales_rep_id ?? null, house: false };
  }
  return { rep: data?.sales_rep_id ?? null, house: Boolean(data?.house_account) && !data?.sales_rep_id };
}

export type CustomerRequestResult = { ok: true; message: string } | { ok: false; error: string };

/** Staff who can't add customers: the details go to the credit team, who vet them and add the customer. */
export async function requestCustomer(input: NewCustomerInput & { note?: string }): Promise<CustomerRequestResult> {
  const s = await getSession();
  if (!s || !s.profile) return { ok: false, error: "Please sign in again." };
  if (!isEmployee(s.profile)) return { ok: false, error: "Only AMBIT staff can request customers." };
  const name = clip(input.name, 120).replace(/\s+/g, " ");
  if (name.length < 2) return { ok: false, error: "Type the customer's company name." };
  const email = clip(input.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  const pattern = name.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: same } = await s.supabase.from("companies").select("name").ilike("name", pattern).eq("active", true).limit(1);
  if (same && same.length) return { ok: false, error: `${(same[0] as { name: string }).name} is already a customer. Search for them instead.` };

  const team = await creditEmailList(s.supabase);
  const to = team.length ? team.map((p) => p.email) : [ACCOUNTING_EMAIL];
  const who = s.profile.full_name || s.profile.email;
  const origin = await currentOrigin();
  const fields: [string, string][] = [
    ["Company", name],
    ["Contact", clip(input.contact, 120) || "-"],
    ["Phone", clip(input.phone, 40) || "-"],
    ["Email", email || "-"],
    ["Billing address", clip(input.billAddress, 400) || "-"],
    ["Shipping address", clip(input.shipAddress, 400) || "Same as billing"],
    ["Home branch", (input.branchId || "-").toUpperCase()],
    ["Note", clip(input.note ?? "", 500) || "-"],
    ["Requested by", `${who} (${s.profile.email})`],
  ];
  const rows = fields
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;width:150px;color:#71717a;font-size:13px;vertical-align:top;">${h(k)}</td><td style="padding:6px 0;font-size:14px;white-space:pre-line;">${h(v)}</td></tr>`)
    .join("");
  const sent = await sendEmail({
    to,
    replyTo: s.profile.email,
    subject: `New customer request · ${name} · from ${who}`,
    html: wrapEmail(
      "New customer request",
      `<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">NEW CUSTOMER REQUEST</div>
<div style="font-size:22px;font-weight:800;margin:4px 0 8px;">${h(name)}</div>
<p style="margin:0 0 16px;color:#52525b;font-size:14px;">${h(who)} would like to order for a new customer. Vet them (credit application and credit approval), then add them in the app so ${h(who)} can pick them. Reply to this email to reach ${h(who)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:20px 0 0;"><a href="${h(origin)}/admin/companies" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px;">Open customers</a></p>`,
    ),
    text: `New customer request from ${who}.\n\n${fields.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nVet them (credit application and credit approval), then add them in the app.\n${origin}/admin/companies`,
  });
  if (sent.status !== "sent") return { ok: false, error: `The request didn't go out (${sent.error ?? sent.status}). Call or email the credit team instead.` };
  return { ok: true, message: `Sent to the credit team (${team.length ? team.map((p) => p.name).join(", ") : "accounting"}). Once ${name} is approved and added, you'll find them here.` };
}

export async function addCustomer(input: NewCustomerInput): Promise<NewCustomerResult> {
  const s = await getSession();
  if (!s || !s.profile) return { ok: false, error: "Please sign in again." };
  if (!isEmployee(s.profile)) return { ok: false, error: "Only AMBIT staff can add customers." };
  // New customers are vetted first (credit application, credit approval): only admins and people with
  // "Add new customers" create them. Everyone else sends a request (requestCustomer).
  if (!can(s.profile, "add_customers")) {
    return { ok: false, error: "New customers are added by the credit team after a credit application. Use Request a new customer." };
  }

  const name = clip(input.name, 120).replace(/\s+/g, " ");
  if (name.length < 2) return { ok: false, error: "Type the customer's company name." };
  const email = clip(input.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  const bill = clip(input.billAddress, 400);
  const ship = clip(input.shipAddress, 400) || bill;

  // Already in the list (same name, any capitalization)? Use that one instead of making a duplicate.
  const pattern = name.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: same } = await s.supabase.from("companies").select(ORDER_CUSTOMER_COLUMNS).ilike("name", pattern).eq("active", true).limit(1);
  if (same && same.length) {
    return { ok: true, existing: true, customer: same[0] as OrderCustomer, message: `${same[0].name} is already in the list, so it's selected.` };
  }

  const { data: branch } = input.branchId
    ? await s.supabase.from("branches").select("id").eq("id", input.branchId).maybeSingle()
    : { data: null };
  const { data: created, error } = await s.supabase
    .from("companies")
    .insert({
      name,
      contact_name: clip(input.contact, 120) || null,
      phone: clip(input.phone, 40) || null,
      email: email || null,
      bill_address: bill || null,
      ship_address: ship || null,
      default_branch_id: branch?.id ?? null,
      source: "app",
      needs_qb_setup: true,
      created_by: s.user.id,
    })
    .select(ORDER_CUSTOMER_COLUMNS)
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Couldn't save the customer. Please try again." };

  const origin = await currentOrigin();
  const who = s.profile.full_name || s.profile.email;
  const rows = [
    ["Company", name],
    ["Contact", created.contact_name ?? "-"],
    ["Phone", created.phone ?? "-"],
    ["Email", created.email ?? "-"],
    ["Billing address", created.bill_address ?? "-"],
    ["Shipping address", created.ship_address ?? "-"],
    ["Home branch", created.default_branch_id?.toUpperCase() ?? "-"],
    ["Added by", `${who} (${s.profile.email})`],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;width:150px;color:#71717a;font-size:13px;vertical-align:top;">${h(k)}</td><td style="padding:6px 0;font-size:14px;white-space:pre-line;">${h(v)}</td></tr>`,
    )
    .join("");
  const sent = await sendEmail({
    to: [ACCOUNTING_EMAIL],
    replyTo: s.profile.email,
    subject: `New customer to set up in QuickBooks · ${name}`,
    html: wrapEmail(
      "New customer",
      `<div style="font-size:22px;font-weight:800;margin-bottom:6px;">New customer added in AMBIT Intelligence</div>
<p style="margin:0 0 16px;color:#52525b;font-size:14px;">${h(who)} added this customer while placing an order. Please set them up in QuickBooks, then add the QuickBooks account number in the app.</p>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:20px 0 0;"><a href="${h(origin)}/admin/companies?needs=1" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px;">Open new customers</a></p>`,
    ),
    text: `New customer added in AMBIT Intelligence by ${who}. Please set them up in QuickBooks.\n\n${[
      ["Company", name],
      ["Contact", created.contact_name ?? "-"],
      ["Phone", created.phone ?? "-"],
      ["Email", created.email ?? "-"],
      ["Billing address", created.bill_address ?? "-"],
      ["Shipping address", created.ship_address ?? "-"],
    ]
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")}\n\n${origin}/admin/companies?needs=1`,
  });

  revalidatePath("/admin/companies");
  return {
    ok: true,
    customer: created as OrderCustomer,
    message:
      sent.status === "sent"
        ? `${name} saved and selected. Accounting has been emailed to set them up in QuickBooks.`
        : `${name} saved and selected. It's flagged for accounting under Admin, Customers.`,
  };
}

export type PlaceOrderInput = {
  items: Record<string, number>;
  delivery: "pickup" | "jobsite" | "dropship";
  branchId: string;
  address: string;
  po: string;
  neededBy: string;
  notes: string;
  companyId: string; // employees only; "__other" = not in list
  customerName: string;
  approvalEmail?: string; // employees only: where the customer's approval link goes
  skipApproval?: boolean; // employees only: approved without the customer's email approval
  draftId?: string; // an AI order intake draft this order came from
  /** Employees only: who gets credit for the order: a staff member's id, or "house" (House Account). Required. */
  salesRep?: string;
  /** Employees only: also make that the customer's sales rep (or House Account) for future orders. */
  repToCustomer?: boolean;
  /** Employees only (custom foam order): the exact lots picked, drums per lot. The rest is picked by the app. */
  lots?: { product_id: string; lot_id: number; qty: number }[];
};

/** sent = went to orders@ (or saved, if email is off); approval = emailed to the customer to approve first. */
export type PlaceOrderResult =
  | { ok: true; id: string; mode: "sent" | "approval"; warning?: string; repError?: string }
  | { ok: false; error: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const s = await getSession();
  if (!s || !s.profile) return { ok: false, error: "Please sign in again." };
  const emp = isEmployee(s.profile);

  const items = Object.entries(input.items ?? {})
    .filter(([id, q]) => UUID.test(id) && Number(q) > 0)
    .map(([product_id, qty]) => ({ product_id, qty: Math.min(Number(qty), 100000) }));
  if (items.length === 0) return { ok: false, error: "Your order is empty." };

  if (emp && !input.companyId) return { ok: false, error: "Choose who this order is for." };
  if (emp && input.companyId === "__other" && !input.customerName.trim()) {
    return { ok: false, error: "Type the customer's name." };
  }
  // Staff: every order names who gets the sales credit (a sales rep, anyone on staff, or House Account).
  const repRaw = String(input.salesRep ?? "").trim();
  const house = repRaw === "house";
  const repId = UUID.test(repRaw) ? repRaw : null;
  if (emp && !house && !repId) return { ok: false, error: "Pick the sales rep for this order (or House Account if no sales rep gets credit)." };
  if (emp && repId) {
    const { data: p } = await s.supabase.from("profiles").select("role, status").eq("id", repId).maybeSingle<{ role: string; status: string }>();
    if (!p || (p.role !== "employee" && p.role !== "admin") || p.status !== "active") return { ok: false, error: "Pick a sales rep who is on AMBIT staff." };
  }
  if (emp && input.delivery !== "dropship" && !input.branchId) {
    return { ok: false, error: "Pick the AMBIT location this order is picked up or shipped from." };
  }
  // A location only sells what's on its own inventory spreadsheet.
  if (input.delivery !== "dropship" && input.branchId) {
    const here = await carriedAt(s.supabase, input.branchId);
    const off = here ? items.filter((i) => !here.has(i.product_id)).map((i) => i.product_id) : [];
    if (off.length) {
      const [{ data: names }, { data: br }] = await Promise.all([
        s.supabase.from("products").select("name").in("id", off),
        s.supabase.from("branches").select("name").eq("id", input.branchId).maybeSingle(),
      ]);
      const list = ((names ?? []) as { name: string }[]).map((p) => p.name).join(" · ") || `${off.length} item${off.length > 1 ? "s" : ""}`;
      return { ok: false, error: `Not on the ${(br as { name: string } | null)?.name ?? "location's"} list: ${list}. Take ${off.length > 1 ? "them" : "it"} off the order or pick a location that carries ${off.length > 1 ? "them" : "it"}.` };
    }
  }
  const neededBy = /^\d{4}-\d{2}-\d{2}$/.test(input.neededBy) ? input.neededBy : null;
  const skip = emp && Boolean(input.skipApproval);
  const needsApproval = emp && approvalsEnabled() && !skip;
  const approvalEmail = String(input.approvalEmail ?? "").trim().slice(0, 200);
  if (needsApproval && !EMAIL_RE.test(approvalEmail)) {
    return { ok: false, error: "Enter the customer's email so they can approve the order." };
  }

  // Staff picked exact lots (custom foam order): only for items on this order, from an AMBIT location.
  const lots = emp && input.delivery !== "dropship"
    ? (Array.isArray(input.lots) ? input.lots : [])
        .filter((l) => l && UUID.test(String(l.product_id)) && Number.isInteger(Number(l.lot_id)) && Number(l.qty) > 0 && items.some((i) => i.product_id === l.product_id))
        .slice(0, 200)
        .map((l) => ({ product_id: String(l.product_id), lot_id: Number(l.lot_id), qty: Math.min(Number(l.qty), 100000) }))
    : [];

  const { data: id, error } = await s.supabase.rpc("place_order", {
    p_items: items,
    p_delivery_method: input.delivery,
    p_branch_id: input.delivery !== "dropship" ? input.branchId || null : null, // deliveries to the contractor ship from a branch too
    p_ship_address: input.delivery === "pickup" ? null : input.address,
    p_po_number: input.po || null,
    p_needed_by: neededBy,
    p_notes: input.notes || null,
    p_company_id: emp && UUID.test(input.companyId) ? input.companyId : null,
    p_customer_name: emp && input.companyId === "__other" ? input.customerName : null,
    ...(lots.length ? { p_lots: lots } : {}),
  });
  if (error || !id) return { ok: false, error: error?.message ?? "Something went wrong. Please try again." };

  const orderId = id as string;
  let repWarning: string | undefined;
  if (emp) repWarning = await saveOrderRep(orderId, UUID.test(input.companyId) ? input.companyId : null, repId, house, Boolean(input.repToCustomer));
  if (emp && input.draftId && UUID.test(input.draftId)) {
    await s.supabase.from("order_drafts").update({ status: "sent", order_id: orderId, updated_at: new Date().toISOString() }).eq("id", input.draftId);
  }
  revalidatePath("/");
  revalidatePath("/orders");
  // Branches with a live inventory sheet: the order's lines go onto PENDING ORDERS right away.
  if (input.delivery !== "dropship") kickSync(input.branchId, "order placed");

  if (needsApproval) {
    const sent = await sendApprovalRequest(s.supabase, orderId, approvalEmail);
    if (sent.setupMissing) {
      // The database update for approvals hasn't been run yet: fall back to the old way.
      await sendOrderEmail(s.supabase, orderId);
      return { ok: true, id: orderId, mode: "sent", repError: repWarning };
    }
    return {
      ok: true,
      id: orderId,
      mode: "approval",
      warning: sent.status === "sent" ? undefined : `The approval email didn't go out (${sent.error ?? sent.status}). Use Resend on the order page.`,
      repError: repWarning,
    };
  }

  if (skip) await s.supabase.rpc("order_approve_without_customer", { p_order: orderId, p_note: null });
  await sendOrderEmail(s.supabase, orderId);
  return { ok: true, id: orderId, mode: "sent", repError: repWarning };
}

/**
 * The sales rep picked on the order screen goes onto the order (staff can't write orders directly, so this runs
 * on the server after the checks above). "Also for future orders" puts it on the customer too, which also credits
 * that rep with the customer's earlier orders that had nobody. Gives back a warning if something didn't save.
 */
async function saveOrderRep(orderId: string, companyId: string | null, rep: string | null, house: boolean, toCustomer: boolean): Promise<string | undefined> {
  if (!serviceReady()) return "The sales rep wasn't saved on the order (SUPABASE_SECRET_KEY isn't set in Vercel). Set it with the Sales rep box on the order page.";
  const db = serviceClient();
  let { error } = await db.from("orders").update({ sales_rep_id: rep, house_account: house }).eq("id", orderId);
  if (error && /house_account/.test(error.message)) {
    // Update 0060 not run yet: save the rep without the House Account mark.
    ({ error } = await db.from("orders").update({ sales_rep_id: rep }).eq("id", orderId));
  }
  if (error) return `The sales rep wasn't saved on the order (${error.message}). Set it with the Sales rep box on the order page.`;
  if (toCustomer && companyId) {
    let { error: e2 } = await db.from("companies").update({ sales_rep_id: rep, house_account: house }).eq("id", companyId);
    if (e2 && /house_account/.test(e2.message)) ({ error: e2 } = await db.from("companies").update({ sales_rep_id: rep }).eq("id", companyId));
    if (e2) return `The sales rep is on the order, but wasn't saved on the customer (${e2.message}).`;
  }
  return undefined;
}
