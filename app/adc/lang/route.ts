import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE, asLang } from "@/lib/adc-i18n";

// English / Español on the ADC store: remember the pick for a year and go back to the same page.
// The redirect is relative, so it always lands on the same site the shopper is on.
export function GET(req: NextRequest) {
  const lang = asLang(req.nextUrl.searchParams.get("l"));
  const next = req.nextUrl.searchParams.get("next") ?? "/adc";
  const safe = /^\/adc(\/|\?|$)/.test(next) && !next.startsWith("//") && !/[\r\n]/.test(next) ? next : "/adc";
  const res = new NextResponse(null, { status: 303, headers: { Location: safe, "Cache-Control": "no-store" } });
  res.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
