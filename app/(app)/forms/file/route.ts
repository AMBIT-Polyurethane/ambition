import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { serviceClient } from "@/lib/supabase/service";

// Open a file from a form: only someone who can see that submission (it's checked against the database rules).
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  const path = req.nextUrl.searchParams.get("p") ?? "";
  const s = await getSession();
  if (!s?.profile) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`, req.url));
  const { data } = await s.supabase.from("form_submissions").select("id, data").eq("id", id).maybeSingle();
  const has = data && JSON.stringify((data as { data: unknown }).data).includes(`"${path}"`);
  if (!has) return new NextResponse("Not found", { status: 404 });
  const { data: signed } = await serviceClient().storage.from("forms").createSignedUrl(path, 300);
  if (!signed?.signedUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(signed.signedUrl);
}
