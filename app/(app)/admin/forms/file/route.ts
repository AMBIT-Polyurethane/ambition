import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchJotformFile, isJotformFile } from "@/lib/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admins: shows an uploaded file or signature from a Jotform submission (Jotform uploads need a login). */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, status").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" || me?.status !== "active") return new NextResponse("Admins only", { status: 403 });

  const u = new URL(req.url).searchParams.get("u") ?? "";
  if (!isJotformFile(u)) return new NextResponse("Not a Jotform file", { status: 400 });
  const file = await fetchJotformFile(u);
  if (!file) return new NextResponse("Couldn't get that file from Jotform", { status: 502 });
  const name = decodeURIComponent(new URL(u).pathname.split("/").pop() ?? "file").replace(/["\\]/g, "");
  // Pictures and PDFs open in the browser; anything else (could be a web page or script) only downloads.
  // Jotform often labels uploads as plain "octet-stream", so the file's ending decides for those.
  const byExt: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const type = /octet-stream|^$/i.test(file.type) && byExt[ext] ? byExt[ext] : file.type;
  const safe = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)\b/i.test(type);
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": safe ? type : "application/octet-stream",
      "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
