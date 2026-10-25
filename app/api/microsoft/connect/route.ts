import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { msAuthorizeUrl, msMissing } from "@/lib/microsoft";
import { serviceReady } from "@/lib/supabase/service";

// Admin > Inventory > Connect Microsoft: off to Microsoft to sign in and allow access to the workbooks.
export const dynamic = "force-dynamic";

export async function GET() {
  const origin = await currentOrigin();
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin" || s.profile.status !== "active") {
    return NextResponse.redirect(`${origin}/signin?next=/admin/inventory`);
  }
  const missing = [...msMissing(), ...(serviceReady() ? [] : ["SUPABASE_SECRET_KEY"])];
  if (missing.length) {
    return NextResponse.redirect(`${origin}/admin/inventory?err=${encodeURIComponent(`Add ${missing.join(", ")} in Vercel first.`)}`);
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(msAuthorizeUrl(`${origin}/api/microsoft/callback`, state));
  res.cookies.set("ms_oauth_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    maxAge: 900,
    path: "/api/microsoft",
  });
  return res;
}
