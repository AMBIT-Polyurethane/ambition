"use server";

import { revalidatePath } from "next/cache";
import { getSession, isEmployee } from "@/lib/session";
import { approvalsEnabled, sendApprovalRequest, sendOrderEmail } from "@/lib/order-send";
import { sendEmail, wrapEmail } from "@/lib/email";
import { ACCOUNTING_EMAIL } from "@/lib/env";
import { currentOrigin } from "@/lib/origin";
import { escapeHtml as h } from "@/lib/format";
import { ORDER_CUSTOMER_COLUMNS, type OrderCustomer } from "@/lib/customers";
import { kickSync } from "@/lib/inventory/sync";

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
export async function addCustomer(input: NewCustomerInput): Promise<NewCustomerResult> {
  const s = await getSession();
  if (!s || !s.profile) return { ok: false, error: "Please sign in again." };
  if (!isEmployee(s.profile)) return { ok: false, error: "Only AMBIT staff can add customers." };

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
      `<div style="font-size:22px;font-weight:800;margin-bottom:6px;">New customer added in AMBITION</div>
<p style="margin:0 0 16px;color:#52525b;font-size:14px;">${h(who)} added this customer while placing an order. Please set them up in QuickBooks, then add the QuickBooks account number in the app.</p>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:20px 0 0;"><a href="${h(origin)}/admin/companies?needs=1" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px;">Open new customers</a></p>`,
    ),
    text: `New customer added in AMBITION by ${who}. Please set them up in QuickBooks.\n\n${[
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
};

/** sent = went to orders@ (or saved, if email is off); approval = emailed to the customer to approve first. */
export type PlaceOrderResult =
  | { ok: true; id: string; mode: "sent" | "approval"; warning?: string }
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
  if (emp && input.delivery !== "dropship" && !input.branchId) {
    return { ok: false, error: "Pick the AMBIT location this order is picked up or shipped from." };
  }
  const neededBy = /^\d{4}-\d{2}-\d{2}$/.test(input.neededBy) ? input.neededBy : null;
  const needsApproval = emp && approvalsEnabled();
  const approvalEmail = String(input.approvalEmail ?? "").trim().slice(0, 200);
  if (needsApproval && !EMAIL_RE.test(approvalEmail)) {
    return { ok: false, error: "Enter the customer's email so they can approve the order." };
  }

  const { data: id, error } = await s.supabase.rpc("place_order", {
    p_items: items,
    p_delivery_method: input.delivery,
    p_branch_id: input.delivery !== "dropship" ? input.branchId || null : null, // job sites ship from a branch too
    p_ship_address: input.delivery === "pickup" ? null : input.address,
    p_po_number: input.po || null,
    p_needed_by: neededBy,
    p_notes: input.notes || null,
    p_company_id: emp && UUID.test(input.companyId) ? input.companyId : null,
    p_customer_name: emp && input.companyId === "__other" ? input.customerName : null,
  });
  if (error || !id) return { ok: false, error: error?.message ?? "Something went wrong. Please try again." };

  const orderId = id as string;
  revalidatePath("/");
  revalidatePath("/orders");
  // Branches with a live inventory sheet: the order's lines go onto PENDING ORDERS right away.
  if (input.delivery !== "dropship") kickSync(input.branchId, "order placed");

  if (needsApproval) {
    const sent = await sendApprovalRequest(s.supabase, orderId, approvalEmail);
    if (sent.setupMissing) {
      // The database update for approvals hasn't been run yet: fall back to the old way.
      await sendOrderEmail(s.supabase, orderId);
      return { ok: true, id: orderId, mode: "sent" };
    }
    return {
      ok: true,
      id: orderId,
      mode: "approval",
      warning: sent.status === "sent" ? undefined : `The approval email didn't go out (${sent.error ?? sent.status}). Use Resend on the order page.`,
    };
  }

  await sendOrderEmail(s.supabase, orderId);
  return { ok: true, id: orderId, mode: "sent" };
}
