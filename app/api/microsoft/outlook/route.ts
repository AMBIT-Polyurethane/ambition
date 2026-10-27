import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getSession, isEmployee } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { msAuthorizeUrl } from "@/lib/microsoft";
import { OUTLOOK_SCOPES, outlookAvailable } from "@/lib/outlook";

// Home > Outlook card > Connect Outlook: off to Microsoft to sign in with your own AMBIT Microsoft 365 account and
// let the app read your inbox and calendar. Comes back through /api/microsoft/callback (the address already
// registered with Microsoft), which finishes it for this person.
export const dynamic = "force-dynamic";

export async function GET() {
  const origin = await currentOrigin();
  const s = await getSession();
  if (!s?.profile || s.profile.status !== "active") return NextResponse.redirect(`${origin}/signin?next=/`);
  if (!isEmployee(s.profile)) return NextResponse.redirect(`${origin}/`);
  if (!outlookAvailable()) {
    return NextResponse.redirect(`${origin}/?outlook_err=${encodeURIComponent("Outlook isn't set up for the app yet. Ask an admin.")}`);
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(msAuthorizeUrl(`${origin}/api/microsoft/callback`, state, OUTLOOK_SCOPES, s.profile.email));
  const cookie = { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax" as const, maxAge: 900, path: "/api/microsoft" };
  res.cookies.set("ms_oauth_state", state, cookie);
  res.cookies.set("ms_oauth_for", "outlook", cookie);
  return res;
}
