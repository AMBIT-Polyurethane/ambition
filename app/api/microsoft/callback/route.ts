import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { msFinishConnect } from "@/lib/microsoft";
import { kickAll } from "@/lib/inventory/sync";

// Microsoft sends the admin back here after they sign in and allow access.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const origin = await currentOrigin();
  const back = (kind: "msg" | "err", text: string) => {
    const res = NextResponse.redirect(`${origin}/admin/inventory?${kind}=${encodeURIComponent(text)}`);
    res.cookies.set("ms_oauth_state", "", { path: "/api/microsoft", maxAge: 0 });
    return res;
  };
  const p = req.nextUrl.searchParams;
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin" || s.profile.status !== "active") {
    return NextResponse.redirect(`${origin}/signin?next=/admin/inventory`);
  }
  if (p.get("error")) {
    const why = (p.get("error_description") || p.get("error") || "").split(/\r?\n/)[0];
    return back("err", `Microsoft didn't connect: ${why}`);
  }
  const state = p.get("state") ?? "";
  if (!state || state !== req.cookies.get("ms_oauth_state")?.value) {
    return back("err", "That sign-in link was old or opened in another browser. Tap Connect Microsoft again.");
  }
  const code = p.get("code");
  if (!code) return back("err", "Microsoft didn't send a sign-in code. Tap Connect Microsoft again.");
  try {
    const acct = await msFinishConnect(code, `${origin}/api/microsoft/callback`, s.profile.full_name || s.profile.email);
    kickAll();
    return back("msg", `Connected to Microsoft as ${acct.name || acct.email}. The spreadsheet is syncing now; refresh in a few seconds.`);
  } catch (e) {
    return back("err", `Microsoft didn't connect: ${e instanceof Error ? e.message : String(e)}`);
  }
}
