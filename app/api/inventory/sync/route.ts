import { NextResponse, type NextRequest } from "next/server";
import { syncAll } from "@/lib/inventory/sync";

// The 2-minute timer (vercel.json "crons"). Vercel sends "Authorization: Bearer <CRON_SECRET>"
// when CRON_SECRET is set in Vercel; without it, anyone calling this only starts the same
// throttled sync the timer would (never more than about once a minute).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const results = await syncAll();
  return NextResponse.json({
    ok: results.every((r) => r.ok || r.skipped),
    results: results.map((r) => ({ branch: r.branch, ok: r.ok, skipped: r.skipped, error: r.error, summary: r.summary })),
  });
}
