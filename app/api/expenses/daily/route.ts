import { NextResponse, type NextRequest } from "next/server";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { plaidReady, syncAll } from "@/lib/plaid";
import { todayCentral } from "@/lib/sale";
import { CHARGE_COLS, RECEIPT_COLS, RECEIPT_COLS_0050, addDays, missing0062, monthView, shiftMonth, type XCharge, type XReceipt } from "@/lib/expense-kinds";
import { mailMissing, mailSubmitted, type Submitted } from "@/lib/expense-mail";

// Every morning (vercel.json "crons"):
// 1. New card charges from the bank link (when Chase is connected).
// 2. Match charges to receipts.
// 3. From the 3rd of the month: last month goes to the approvers on its own for everyone whose card charges all
//    have a receipt (and who hasn't sent it). Everyone else gets a reminder (on the 3rd, then on Mondays).
// 4. Mondays: a reminder to anyone with card charges over 3 days old that still need a receipt.
// Vercel sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const origin = () => (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!serviceReady()) return NextResponse.json({ ok: true, skipped: "SUPABASE_SECRET_KEY not set" });
  const db = serviceClient();
  const out: Record<string, unknown> = {};

  if (plaidReady()) out.bank = await syncAll(db);
  const { data: matched, error: mErr } = await db.rpc("expense_auto_match", { p_user: null });
  out.matched = mErr ? mErr.message : matched;

  const today = todayCentral();
  const dom = Number(today.slice(8, 10));
  const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  const last = shiftMonth(today.slice(0, 7), -1);
  const lastFrom = `${last}-01`;
  const thisFrom = `${today.slice(0, 7)}-01`;

  const { data: staff } = await db.from("profiles").select("id, full_name, email, status, role").in("role", ["employee", "admin"]).eq("status", "active");
  const who = new Map(((staff ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, { name: p.full_name || p.email, email: p.email }]));
  const site = origin();

  // ---- last month: send it on its own, or remind
  if (dom >= 3) {
    // Before migration 0062 the newer receipt columns aren't there: fall back to the older list.
    const recsFor = (cols: string) => db.from("expense_receipts").select(cols).is("deleted_at", null).gte("bought_on", addDays(lastFrom, -10)).lt("bought_on", addDays(thisFrom, 10)).limit(20000);
    const [firstRecs, { data: chgs }, { data: reps }] = await Promise.all([
      recsFor(RECEIPT_COLS),
      db.from("expense_charges").select(CHARGE_COLS).eq("removed", false).not("user_id", "is", null).gte("txn_date", addDays(lastFrom, -10)).lt("txn_date", addDays(thisFrom, 10)).limit(20000),
      db.from("expense_reports").select("user_id, status").eq("month", lastFrom),
    ]);
    const recRes = firstRecs.error && missing0062(firstRecs.error) ? await recsFor(RECEIPT_COLS_0050) : firstRecs;
    if (recRes.error) throw new Error(recRes.error.message);
    const recs = recRes.data as unknown as XReceipt[] | null;
    const sent = new Map(((reps ?? []) as { user_id: string; status: string }[]).map((r) => [r.user_id, r.status]));
    const users = new Set<string>([
      ...((recs ?? []) as XReceipt[]).filter((r) => r.bought_on >= lastFrom && r.bought_on < thisFrom).map((r) => r.user_id),
      ...((chgs ?? []) as XCharge[]).filter((c) => c.txn_date >= lastFrom && c.txn_date < thisFrom && c.user_id).map((c) => c.user_id as string),
    ]);
    let auto = 0;
    let reminded = 0;
    for (const uid of users) {
      const p = who.get(uid);
      if (!p || sent.get(uid) === "submitted" || sent.get(uid) === "approved" || sent.get(uid) === "sent") continue;
      const mine = ((recs ?? []) as XReceipt[]).filter((r) => r.user_id === uid).map((r) => ({ ...r, amount: Number(r.amount) }));
      const theirs = ((chgs ?? []) as XCharge[]).filter((c) => c.user_id === uid).map((c) => ({ ...c, amount: Number(c.amount) }));
      const view = monthView(last, mine, theirs);
      if (view.missing.length) {
        if (dom === 3 || monday) {
          const r = await mailMissing(p, view.missing, site, last);
          if (r.status === "sent") reminded++;
        }
        continue;
      }
      // A month that was sent back waits for the person to fix it and send it again.
      if (sent.get(uid) === "returned") continue;
      const { data, error } = await db.rpc("expense_submit_for", { p_user: uid, p_month: lastFrom, p_auto: true });
      if (error) continue;
      const s = { ...(data as Omit<Submitted, "userId">), userId: uid };
      const res = await mailSubmitted(s, view, site, { auto: true });
      await db.from("expense_reports").update({ email_status: res.status, sent_to: s.approvers.map((a) => a.email) }).eq("user_id", uid).eq("month", lastFrom);
      auto++;
    }
    out.auto_submitted = auto;
    out.month_reminders = reminded;
  }

  // ---- Mondays: this month's charges over 3 days old with no receipt
  if (monday) {
    const { data: open } = await db
      .from("expense_charges")
      .select(CHARGE_COLS)
      .eq("removed", false)
      .eq("kind", "purchase")
      .is("receipt_id", null)
      .is("excused_note", null)
      .not("user_id", "is", null)
      .gte("txn_date", thisFrom)
      .lte("txn_date", addDays(today, -3))
      .limit(5000);
    const by = new Map<string, XCharge[]>();
    for (const c of (open ?? []) as XCharge[]) by.set(c.user_id as string, [...(by.get(c.user_id as string) ?? []), c]);
    let weekly = 0;
    for (const [uid, list] of by) {
      const p = who.get(uid);
      if (!p) continue;
      const r = await mailMissing(p, list.sort((a, b) => a.txn_date.localeCompare(b.txn_date)), site);
      if (r.status === "sent") weekly++;
    }
    out.weekly_reminders = weekly;
  }

  return NextResponse.json({ ok: true, ...out });
}
