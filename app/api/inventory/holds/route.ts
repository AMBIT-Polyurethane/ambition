import { NextResponse, type NextRequest } from "next/server";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { emailConfigured, sendEmail, wrapEmail } from "@/lib/email";
import { holdsAt } from "@/lib/inventory/holds";
import { todayCentral } from "@/lib/sale";
import { dateShort } from "@/lib/format";

// Daily (vercel.json "crons"): whoever placed a hold on a lot for a customer (0071) is emailed 3 days before it runs
// out, once, so they can change the date or let it go. Vercel sends "Authorization: Bearer <CRON_SECRET>".
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!serviceReady()) return NextResponse.json({ ok: true, skipped: "SUPABASE_SECRET_KEY not set" });
  if (!emailConfigured()) return NextResponse.json({ ok: true, skipped: "email not set up" });

  const db = serviceClient();
  const today = todayCentral();
  const soon = (await holdsAt(db, null)).filter((h) => h.held_left > 0 && days(today, h.until) <= 3 && h.by_id);
  if (!soon.length) return NextResponse.json({ ok: true, sent: 0 });
  const { data: done } = await db.from("inventory_holds").select("id").in("id", soon.map((h) => h.id)).not("reminded_at", "is", null);
  const already = new Set(((done ?? []) as { id: number }[]).map((r) => r.id));
  const due = soon.filter((h) => !already.has(h.id));
  const { data: people } = await db.from("profiles").select("id, email, full_name, status").in("id", [...new Set(due.map((h) => h.by_id!))]);
  const who = new Map(((people ?? []) as { id: string; email: string; full_name: string | null; status: string }[]).filter((p) => p.status === "active").map((p) => [p.id, p]));
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/$/, "");
  let sent = 0;
  for (const h of due) {
    const p = who.get(h.by_id!);
    if (!p?.email) continue;
    const left = days(today, h.until);
    const when = left <= 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`;
    const link = `${origin}/inventory/holds?b=${h.branch_id}`;
    const res = await sendEmail({
      to: [p.email],
      subject: `Hold on lot ${h.lot_no ?? h.sku} for ${h.company_name} ends ${dateShort(h.until)}`,
      html: wrapEmail(
        "A hold is about to end",
        `<p>${esc(p.full_name?.split(" ")[0] ?? "Hi")},</p>
         <p>The <b>${h.held_left}</b> drums of <b>${esc(h.sku)}</b>, lot <b>${esc(h.lot_no ?? "(no lot #)")}</b>, you held at ${esc(h.branch_id.toUpperCase())} for
         <b>${esc(h.company_name)}</b> stop being held ${when} (${esc(dateShort(h.until))}). After that, other customers' orders can get them.</p>
         ${h.note ? `<p>Your note: ${esc(h.note)}</p>` : ""}
         <p>To keep them aside longer, change the date: <a href="${link}">${esc(link)}</a></p>`,
      ),
      text: `The ${h.held_left} drums of ${h.sku}, lot ${h.lot_no ?? "(no lot #)"}, you held at ${h.branch_id.toUpperCase()} for ${h.company_name} stop being held ${when} (${dateShort(h.until)}). To keep them aside longer, change the date: ${link}`,
    });
    if (res.status === "sent") {
      await db.from("inventory_holds").update({ reminded_at: new Date().toISOString() }).eq("id", h.id);
      sent++;
    }
  }
  return NextResponse.json({ ok: true, sent });
}
