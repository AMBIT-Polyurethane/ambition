"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { sendEmail, wrapEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { escapeHtml as h } from "@/lib/format";
import { creditEmailList } from "@/lib/order-send";

const back = (kind: "msg" | "err", text: string): never => redirect(`/admin/email-alerts?${kind}=${encodeURIComponent(text)}`);

/** Admin: who gets the "Credit check needed" emails (everyone ticked; everyone else comes off). */
export async function saveCreditEmails(form: FormData) {
  const { supabase } = await requireAdmin();
  const ids = form.getAll("credit").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const { error } = await supabase.rpc("set_credit_emails", { p_ids: ids });
  if (error) back("err", error.message);
  const list = await creditEmailList(supabase);
  back("msg", `Saved. Credit check emails go to ${list.map((p) => p.name).join(", ")}.`);
}

/** Admin: a test email to everyone on the list, so they can see it arrives (and isn't in junk). */
export async function testCreditEmails() {
  const { supabase } = await requireAdmin();
  const list = await creditEmailList(supabase);
  if (!list.length) back("err", "Nobody is on the list yet. Tick at least one person and Save first.");
  const link = `${await currentOrigin()}/orders/desk`;
  const names = list.map((p) => p.name).join(", ");
  const inner = `
<div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#E33527;">TEST · CREDIT CHECK EMAILS</div>
<div style="font-size:22px;font-weight:800;margin:4px 0 12px;">You're on the credit check list</div>
<p style="font-size:15px;margin:0 0 12px;line-height:1.5;">This is a test from the AMBIT Intelligence app. When the CRM enters an order's Sales Order # and Invoice #, an email like this one goes to: <b>${h(names)}</b>. Open the order, check the account, then Release order or Put on credit hold.</p>
<p style="font-size:14px;margin:0;line-height:1.5;">Nothing to do for this test. If it landed in Junk, mark it "Not junk" so the real ones don't.</p>
<p style="margin:20px 0 0;"><a href="${h(link)}" style="display:inline-block;background:#E33527;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:13px 20px;border-radius:8px;">OPEN THE ORDER DESK</a></p>`;
  const sent = await sendEmail({
    to: list.map((p) => p.email),
    subject: "Test: AMBIT credit check emails",
    html: wrapEmail("Credit check", inner),
    text: `TEST: AMBIT credit check emails\n\nWhen the CRM enters an order's Sales Order # and Invoice #, a credit check email goes to: ${names}.\nNothing to do for this test.\n\n${link}`,
  });
  if (sent.status !== "sent") back("err", `The test didn't go out (${sent.error ?? sent.status}).`);
  back("msg", `Test email sent to ${names}. Ask them to check their inbox (and Junk).`);
}
