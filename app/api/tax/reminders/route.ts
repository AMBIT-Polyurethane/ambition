import { NextResponse, type NextRequest } from "next/server";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { canEmailCustomers, emailConfigured, sendEmail, wrapEmail } from "@/lib/email";
import { ACCOUNTING_EMAIL } from "@/lib/env";
import { computeTaxState, type CertRow } from "@/lib/tax";
import { todayCentral } from "@/lib/sale";
import { dateShort } from "@/lib/format";

// Daily (vercel.json "crons"): reminds tax-exempt customers 60 and 30 days before their certificate runs
// out, and on the day it has expired, with Accounting copied. Each reminder goes out once. Nothing is sent
// until app email is set up. Vercel sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!serviceReady()) return NextResponse.json({ ok: true, skipped: "SUPABASE_SECRET_KEY not set" });
  if (!emailConfigured()) return NextResponse.json({ ok: true, skipped: "email not set up" });

  const db = serviceClient();
  const { data: certs, error } = await db.from("tax_certificates").select("*").in("status", ["verified", "pending"]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const byCompany = new Map<string, CertRow[]>();
  for (const c of (certs ?? []) as CertRow[]) byCompany.set(c.company_id, [...(byCompany.get(c.company_id) ?? []), c]);
  if (!byCompany.size) return NextResponse.json({ ok: true, sent: 0 });

  const { data: comps } = await db.from("companies").select("id, name, email, tax_exempt, active").in("id", [...byCompany.keys()]);
  const today = todayCentral();
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/$/, "");
  let sent = 0;
  const done: string[] = [];

  for (const co of (comps ?? []) as { id: string; name: string; email: string | null; tax_exempt: boolean; active: boolean }[]) {
    if (!co.active || !co.tax_exempt) continue;
    const list = byCompany.get(co.id) ?? [];
    const t = computeTaxState(co.tax_exempt, list, today);
    const cert = list.find((c) => c.id === t.cert_id);
    if (!cert) continue;
    let which: "60" | "30" | "expired" | null = null;
    if (t.state === "expired" && !cert.remind_expired_at) which = "expired";
    else if (t.state === "expiring" && (t.days_left ?? 99) <= 30 && !cert.remind_30_at) which = "30";
    else if (t.state === "expiring" && (t.days_left ?? 99) <= 60 && !cert.remind_60_at && !cert.remind_30_at) which = "60";
    if (!which) continue;

    // The customer's contacts: the company email and the contractors who sign in for it.
    const { data: people } = await db.from("profiles").select("email").eq("company_id", co.id).eq("status", "active").eq("role", "customer");
    const to = [co.email, ...((people ?? []) as { email: string }[]).map((p) => p.email)].filter((e): e is string => Boolean(e));
    const customerOk = canEmailCustomers() && to.length > 0;
    const when = cert.expires_on ? dateShort(cert.expires_on) : "";
    const subject = which === "expired" ? `Your tax-exempt certificate on file with AMBIT has expired` : `Your tax-exempt certificate on file with AMBIT expires ${when}`;
    const body =
      which === "expired"
        ? `The ${cert.state ?? ""} tax-exempt certificate AMBIT has on file for ${co.name} expired on ${when}. Until we have a current one, new orders are held for Accounting, or sales tax is charged.`
        : `The ${cert.state ?? ""} tax-exempt certificate AMBIT has on file for ${co.name} expires on ${when} (in ${t.days_left} days). Please send the renewed certificate so your orders stay tax-exempt.`;
    const link = `${origin}/profile#tax`;
    const html = wrapEmail(
      "Tax certificate",
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">${esc(body)}</p>
<p style="margin:0 0 14px;font-size:15px;">Upload it in the app: Profile → Sales-tax exemption → Send a new or renewed certificate. Or reply to this email with a copy.</p>
${origin ? `<p style="margin:0;"><a href="${link}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:800;letter-spacing:1px;padding:12px 18px;border-radius:8px;">UPLOAD THE CERTIFICATE</a></p>` : ""}`,
    );
    const r = await sendEmail({
      to: customerOk ? to : ACCOUNTING_EMAIL ? [ACCOUNTING_EMAIL] : [],
      cc: customerOk && ACCOUNTING_EMAIL ? [ACCOUNTING_EMAIL] : [],
      replyTo: ACCOUNTING_EMAIL || undefined,
      subject: customerOk ? subject : `[Not sent to the customer] ${co.name}: ${subject.toLowerCase()}`,
      text: `${body}\n\nUpload it in the app: ${link}`,
      html,
    });
    if (r.status === "sent") {
      sent++;
      done.push(`${co.name}: ${which}`);
      const col = which === "60" ? "remind_60_at" : which === "30" ? "remind_30_at" : "remind_expired_at";
      await db.from("tax_certificates").update({ [col]: new Date().toISOString() }).eq("id", cert.id);
    }
  }
  return NextResponse.json({ ok: true, sent, done });
}
