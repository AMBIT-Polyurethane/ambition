import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchJotformFile } from "@/lib/forms";
import { receiptById } from "@/lib/expenses";
import { shrinkImage } from "@/lib/image-shrink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A receipt photo: for the person who uploaded it and for admins. ?w= makes a smaller copy (thumbnails). */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("email, role, status").eq("id", user.id).maybeSingle();
  if (!me || me.status !== "active" || me.role === "customer") return new NextResponse("Not allowed", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const r = await receiptById(sp.get("s") ?? "");
  if (!r) return new NextResponse("Receipt not found", { status: 404 });
  if (me.role !== "admin" && r.email !== String(me.email).toLowerCase()) return new NextResponse("Not your receipt", { status: 403 });
  const u = r.files[Math.max(0, Number(sp.get("i")) || 0)];
  if (!u) return new NextResponse("No photo on this receipt", { status: 404 });

  const file = await fetchJotformFile(u);
  if (!file) return new NextResponse("Couldn't get the photo from Jotform", { status: 502 });
  const name = decodeURIComponent(new URL(u).pathname.split("/").pop() ?? "receipt").replace(/["\\]/g, "");
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const isPdf = ext === "pdf" || /pdf/i.test(file.type);

  if (!isPdf) {
    const w = Math.min(2000, Math.max(80, Number(sp.get("w")) || 1600));
    const small = await shrinkImage(file.body, w, w <= 400 ? 70 : 82);
    if (small) {
      return new NextResponse(new Uint8Array(small.body), {
        headers: { "Content-Type": small.type, "Content-Disposition": `inline; filename="${name.replace(/\.[^.]+$/, "")}.jpg"`, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
      });
    }
  }
  const byExt: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
  const type = /octet-stream|^$/i.test(file.type) && byExt[ext] ? byExt[ext] : file.type;
  const safe = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)\b/i.test(type);
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": safe ? type : "application/octet-stream",
      "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
