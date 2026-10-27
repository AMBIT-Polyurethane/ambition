import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An invoice or signed BOL on an order: AMBIT staff only. Opens a short-lived link to the private file. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  // Row-level security only shows these rows to active AMBIT staff.
  const { data: f } = await supabase
    .from("order_files")
    .select("path")
    .eq("id", Number(fileId))
    .eq("order_id", id)
    .maybeSingle<{ path: string }>();
  if (!f) return new NextResponse("File not found", { status: 404 });
  const { data, error } = await supabase.storage.from("order-files").createSignedUrl(f.path, 120);
  if (error || !data?.signedUrl) return new NextResponse("Couldn't open the file", { status: 502 });
  return NextResponse.redirect(data.signedUrl, 302);
}
