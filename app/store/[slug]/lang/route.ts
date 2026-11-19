import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE, asLang } from "@/lib/adc-i18n";

// English / Español on a partner's store: remember the pick for a year and go back to the same page of that store.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = `/store/${encodeURIComponent(slug)}`;
  const lang = asLang(req.nextUrl.searchParams.get("l"));
  const next = req.nextUrl.searchParams.get("next") ?? home;
  const safe = next.startsWith(home) && !next.startsWith("//") && !/[\r\n]/.test(next) ? next : home;
  const res = new NextResponse(null, { status: 303, headers: { Location: safe, "Cache-Control": "no-store" } });
  res.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
