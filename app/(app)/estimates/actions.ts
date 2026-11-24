"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/session";
import { can, canEstimate, canFreight } from "@/lib/access";
import { sendEmail, wrapEmail } from "@/lib/email";
import { siteUrl } from "@/lib/env";
import { money } from "@/lib/format";
import { estNo, loadEstimate } from "@/lib/estimates";
import { estimateFileName, renderEstimatePdf } from "@/lib/estimate-pdf";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const nice = (e: { message?: string } | null) => (e?.message ?? "Something went wrong.").replace(/^.*?ERROR:\s*/, "");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function staff() {
  const s = await getSession();
  if (!s?.profile || !canEstimate(s.profile)) return null;
  return { ...s, profile: s.profile };
}

const refresh = (id?: string) => {
  revalidatePath("/estimates");
  if (id) revalidatePath(`/estimates/${id}`);
};

export type EstimateInput = {
  id?: string | null;
  company_id: string;
  delivery_method: "pickup" | "jobsite";
  branch_id: string;
  ship_address: string;
  ship_state: string;
  ship_zip: string;
  customer_note: string;
  staff_note: string;
  items: { product_id: string; qty: number }[];
};

/** Save the estimate (new or changed). Prices come from the customer's price list. */
export async function saveEstimate(input: EstimateInput, done = false): Promise<Res<{ id: string; status?: string }>> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to estimates." };
  const { data, error } = await s.supabase.rpc("estimate_save", { p: input });
  if (error) return { ok: false, error: nice(error) };
  const id = String(data);
  let status: string | undefined;
  if (done) {
    const r = await submitEstimate(id);
    if (!r.ok) return r;
    status = r.status;
  }
  refresh(id);
  return { ok: true, id, status };
}

/** Emails of the people who add freight (CRMs with "Estimates: add freight"); admins when nobody has it. */
async function freightPeople(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("profiles").select("email").eq("role", "employee").eq("status", "active").eq("demo", false).contains("perms", ["estimate_freight"]);
  const list = ((data ?? []) as { email: string | null }[]).map((r) => r.email ?? "").filter(Boolean);
  if (list.length) return list;
  const { data: admins } = await db.from("profiles").select("email").eq("role", "admin").eq("status", "active").eq("demo", false);
  return ((admins ?? []) as { email: string | null }[]).map((r) => r.email ?? "").filter(Boolean);
}

/** The rep is done: a pickup is ready to send; a delivery goes to the CRMs for the freight (they get an email). */
export async function submitEstimate(id: string): Promise<Res<{ status: string }>> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to estimates." };
  const { data, error } = await s.supabase.rpc("estimate_submit", { p_id: id });
  if (error) return { ok: false, error: nice(error) };
  const status = String(data);
  if (status === "needs_freight") {
    const d = await loadEstimate(s.supabase, id);
    const to = await freightPeople(s.supabase);
    if (d && to.length) {
      const e = d.est;
      const link = `${siteUrl()}/estimates/${id}`;
      await sendEmail({
        to,
        replyTo: e.created_by_email ?? undefined,
        subject: `Freight needed: ${estNo(e.est_no)} for ${e.company_name}`,
        text: `${e.created_by_name ?? "A rep"} needs the freight for estimate ${estNo(e.est_no)} (${e.company_name}), delivered to ${e.ship_address ?? ""} ${e.ship_state ?? ""} ${e.ship_zip ?? ""}. ${d.items.length} items, ${money(e.subtotal)}.\n\nAdd it here: ${link}`,
        html: wrapEmail(
          "Freight needed",
          `<p style="margin:0 0 12px;font-size:15px;"><b>${esc(e.created_by_name ?? "A rep")}</b> needs the freight for estimate <b>${estNo(e.est_no)}</b> for <b>${esc(e.company_name)}</b>.</p>
<p style="margin:0 0 6px;color:#52525b;">Deliver to: ${esc([e.ship_address, e.ship_state, e.ship_zip].filter(Boolean).join(", "))}</p>
<p style="margin:0 0 16px;color:#52525b;">${d.items.map((i) => `${i.qty} &times; ${esc(i.sku)}`).join(", ")} &middot; items ${money(e.subtotal)}</p>
<p style="margin:0;"><a href="${link}" style="background:#E33527;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold;display:inline-block;">Add the freight</a></p>`,
        ),
      });
    }
  }
  refresh(id);
  return { ok: true, status };
}

export type FreightInput = { freight: string; freight_note: string; tax_rate: string; tax_freight: boolean; valid_until: string };

/** A CRM adds the quoted freight (and may type the tax rate). The rep gets an email that it's ready to send. */
export async function setFreight(id: string, input: FreightInput): Promise<Res> {
  const s = await getSession();
  if (!s?.profile || !canFreight(s.profile)) return { ok: false, error: "Only CRMs and admins add freight to estimates." };
  const before = await loadEstimate(s.supabase, id);
  const { error } = await s.supabase.rpc("estimate_set_freight", { p_id: id, p: input });
  if (error) return { ok: false, error: nice(error) };
  const after = await loadEstimate(s.supabase, id);
  if (before && after && before.est.status === "needs_freight" && after.est.created_by_email && after.est.created_by !== s.profile.id) {
    const e = after.est;
    const link = `${siteUrl()}/estimates/${id}`;
    await sendEmail({
      to: [e.created_by_email!],
      subject: `Ready to send: ${estNo(e.est_no)} for ${e.company_name}`,
      text: `${e.freight_by_name ?? "A CRM"} added the freight (${money(e.freight)}) to ${estNo(e.est_no)} for ${e.company_name}. Total ${money(e.total)}.\n\nSend it to the customer: ${link}`,
      html: wrapEmail(
        "Estimate ready",
        `<p style="margin:0 0 12px;font-size:15px;"><b>${esc(e.freight_by_name ?? "A CRM")}</b> added the freight to <b>${estNo(e.est_no)}</b> for <b>${esc(e.company_name)}</b>.</p>
<p style="margin:0 0 16px;color:#52525b;">Freight ${money(e.freight)} &middot; tax ${e.tax === null ? "not set" : money(e.tax)} &middot; <b>total ${money(e.total)}</b></p>
<p style="margin:0;"><a href="${link}" style="background:#E33527;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold;display:inline-block;">Send it to the customer</a></p>`,
      ),
    });
  }
  refresh(id);
  return { ok: true };
}

/** Price it again from today's price list. */
export async function repriceEstimate(id: string): Promise<Res> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to estimates." };
  const { error } = await s.supabase.rpc("estimate_reprice", { p_id: id });
  if (error) return { ok: false, error: nice(error) };
  refresh(id);
  return { ok: true };
}

export async function cancelEstimate(id: string): Promise<Res> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to estimates." };
  const { error } = await s.supabase.rpc("estimate_cancel", { p_id: id });
  if (error) return { ok: false, error: nice(error) };
  refresh(id);
  return { ok: true };
}

/** The customers' contacts' emails, to fill in "Send to". */
export async function customerEmails(companyId: string): Promise<string[]> {
  const s = await staff();
  if (!s) return [];
  const { data: co } = await s.supabase.from("companies").select("email").eq("id", companyId).maybeSingle<{ email: string | null }>();
  const { data: people } = await s.supabase.from("profiles").select("email").eq("company_id", companyId).eq("status", "active").limit(10);
  const all = [co?.email, ...((people ?? []) as { email: string | null }[]).map((p) => p.email)].filter((x): x is string => Boolean(x && /@/.test(x)));
  return [...new Set(all.map((x) => x.trim()))].slice(0, 10);
}

/** Email the estimate to the customer (priced again at today's prices first). Replies go to the rep. */
export async function sendEstimate(id: string, input: { to: string; message: string }): Promise<Res<{ to: string[] }>> {
  const s = await staff();
  if (!s) return { ok: false, error: "You don't have access to estimates." };
  const to = [...new Set(input.to.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
  const bad = to.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (!to.length) return { ok: false, error: "Type the customer's email." };
  if (bad) return { ok: false, error: `"${bad}" isn't an email address.` };
  if (to.length > 5) return { ok: false, error: "Send it to 5 people at most." };
  const first = await loadEstimate(s.supabase, id);
  if (!first) return { ok: false, error: "Estimate not found." };
  if (!["ready", "sent"].includes(first.est.status)) {
    return { ok: false, error: first.est.status === "needs_freight" ? "It's waiting for a CRM to add the freight." : `This estimate is ${first.est.status}.` };
  }
  // Always today's price.
  const rp = await s.supabase.rpc("estimate_reprice", { p_id: id });
  if (rp.error) return { ok: false, error: nice(rp.error) };
  const d = await loadEstimate(s.supabase, id);
  if (!d) return { ok: false, error: "Estimate not found." };
  const e = d.est;
  const { data: b } = e.branch_id ? await s.supabase.from("branches").select("name").eq("id", e.branch_id).maybeSingle<{ name: string }>() : { data: null };
  const pdf = await renderEstimatePdf(e, d.items, b?.name ?? null);
  const note = input.message.trim().slice(0, 2000);
  const who = s.profile.full_name ?? e.created_by_name ?? "AMBIT Polyurethane";
  const replyTo = e.created_by_email ?? s.profile.email ?? undefined;
  const res = await sendEmail({
    to,
    cc: [s.profile.email, e.created_by_email].filter((x): x is string => Boolean(x)),
    replyTo,
    fromName: `${who} at AMBIT`,
    subject: `AMBIT estimate ${estNo(e.est_no)} for ${e.company_name}`,
    text: `${note ? note + "\n\n" : ""}Attached is an unofficial estimate (${estNo(e.est_no)}) for ${e.company_name}: estimated total ${money(e.total)}${e.valid_until ? `, good until ${e.valid_until}` : ""}. It is not an order or an invoice. Reply to this email to place the order or ask a question.\n\n${who}\nAMBIT Polyurethane`,
    html: wrapEmail(
      "Estimate",
      `${note ? `<p style="margin:0 0 14px;font-size:15px;white-space:pre-wrap;">${esc(note)}</p>` : ""}
<p style="margin:0 0 12px;font-size:15px;">Attached is your unofficial estimate <b>${estNo(e.est_no)}</b> for <b>${esc(e.company_name)}</b>.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;font-size:14px;">
<tr><td style="padding:2px 18px 2px 0;color:#52525b;">Items</td><td align="right">${money(e.subtotal)}</td></tr>
<tr><td style="padding:2px 18px 2px 0;color:#52525b;">Freight</td><td align="right">${e.freight === null ? "To be quoted" : money(e.freight)}</td></tr>
<tr><td style="padding:2px 18px 2px 0;color:#52525b;">Sales tax</td><td align="right">${e.tax_exempt ? "Exempt" : e.tax === null ? "To be added" : money(e.tax)}</td></tr>
<tr><td style="padding:6px 18px 2px 0;font-weight:bold;">Estimated total</td><td align="right" style="padding-top:6px;font-weight:bold;">${money(e.total)}</td></tr>
</table>
<p style="margin:0 0 6px;color:#52525b;font-size:13px;">This is an estimate only, not an order or an invoice. Prices are from your AMBIT price list today${e.valid_until ? ` and this estimate is good until ${e.valid_until}` : ""}.</p>
<p style="margin:0;color:#52525b;font-size:13px;">Reply to this email to place the order or ask a question.</p>
<p style="margin:16px 0 0;">${esc(who)}<br/>AMBIT Polyurethane</p>`,
    ),
    attachments: [{ filename: estimateFileName(e), content: pdf, contentType: "application/pdf" }],
  });
  if (res.status === "failed") return { ok: false, error: `The email didn't go out: ${res.error ?? "unknown error"}.` };
  if (res.status === "not_configured") return { ok: false, error: "The app's email isn't set up, so it can't send. Download the PDF and email it yourself." };
  await s.supabase.rpc("estimate_mark_sent", { p_id: id, p_to: to.join(", ") });
  refresh(id);
  return { ok: true, to };
}

/** Turn it into an order: the order screen opens with the same customer, delivery and items, ready to check and place. */
export async function estimateToOrder(id: string): Promise<Res<{ draft: string }>> {
  const s = await getSession();
  if (!s?.profile || !can(s.profile, "ordering")) return { ok: false, error: "Placing orders takes the Ordering permission." };
  const { data, error } = await s.supabase.rpc("estimate_to_draft", { p_id: id });
  if (error) return { ok: false, error: nice(error) };
  return { ok: true, draft: String(data) };
}

/** Accounting / admins: add, change or remove (blank rate) a sales tax rate. */
export async function saveTaxRate(input: { kind: string; key: string; rate: string; tax_freight: boolean; label: string }): Promise<Res> {
  const s = await getSession();
  if (!s?.profile || !(s.profile.role === "admin" || can(s.profile, "credit_check"))) return { ok: false, error: "Only Accounting and admins change tax rates." };
  const { error } = await s.supabase.rpc("tax_rate_save", { p: input });
  if (error) return { ok: false, error: nice(error) };
  revalidatePath("/estimates/tax-rates");
  return { ok: true };
}

export type PricedLine = { product_id: string; unit_price: number | null; line_total: number | null; basis: string | null; per: number | null; source: string | null };

/** Today's prices for these items for this customer (shown while the estimate is built; nothing is saved). */
export async function previewPrices(companyId: string, items: { product_id: string; qty: number }[]): Promise<PricedLine[]> {
  const s = await staff();
  if (!s || !companyId || !items.length) return [];
  const { data, error } = await s.supabase.rpc("price_lines", { p_company: companyId, p_lines: items.slice(0, 200) });
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_id: String(r.product_id),
    unit_price: r.unit_price == null ? null : Number(r.unit_price),
    line_total: r.line_total == null ? null : Number(r.line_total),
    basis: (r.basis as string) ?? null,
    per: r.per == null ? null : Number(r.per),
    source: (r.source as string) ?? null,
  }));
}
