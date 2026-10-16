import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/origin";

// Finishes Microsoft sign-in and email links (confirm address, reset password).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  if (!ok) {
    const isMs = url.searchParams.get("error") || url.searchParams.get("error_description");
    return NextResponse.redirect(new URL(`/signin?error=${isMs ? "microsoft" : "link"}`, request.url));
  }

  // AMBIT staff signing in with Microsoft become active employees automatically.
  await supabase.rpc("sync_microsoft_employee");
  return NextResponse.redirect(new URL(next, request.url));
}
