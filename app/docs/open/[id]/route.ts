import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Opens a document: uploaded files get a short-lived private link, external links redirect.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/signin?next=/docs`, request.url));

  const { data: doc } = await supabase.from("documents").select("url, storage_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.redirect(new URL("/docs", request.url));

  if (doc.storage_path) {
    const { data } = await supabase.storage.from("docs").createSignedUrl(doc.storage_path, 60 * 10);
    if (data?.signedUrl) return NextResponse.redirect(data.signedUrl);
  }
  if (doc.url) return NextResponse.redirect(doc.url);
  return NextResponse.redirect(new URL("/docs", request.url));
}
