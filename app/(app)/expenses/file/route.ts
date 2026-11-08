import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchJotformFile } from "@/lib/forms";
import { shrinkImage } from "@/lib/image-shrink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A receipt photo (?r=<receipt>&i=<which photo>), for the person who saved it and for expense approvers: the
 * database decides who may see the receipt and the photo. ?w= makes a smaller copy (thumbnails).
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });

  const sp = new URL(req.url).searchParams;
  const id = sp.get("r") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Receipt not found", { status: 404 });
  const { data: r } = await supabase.from("expense_receipts").select("photos").eq("id", id).maybeSingle();
  if (!r) return new NextResponse("Receipt not found", { status: 404 });
  const key = ((r.photos as string[]) ?? [])[Math.max(0, Number(sp.get("i")) || 0)];
  if (!key) return new NextResponse("No photo on this receipt", { status: 404 });

  let body: Buffer | null = null;
  let type = "";
  let name = "receipt";
  if (/^https:\/\//.test(key)) {
    const f = await fetchJotformFile(key);
    if (f) {
      body = Buffer.from(f.body);
      type = f.type;
    }
    name = decodeURIComponent(new URL(key).pathname.split("/").pop() ?? "receipt");
  } else {
    const { data } = await supabase.storage.from("receipts").download(key);
    if (data) {
      body = Buffer.from(await data.arrayBuffer());
      type = data.type;
    }
    name = key.split("/").pop() ?? "receipt";
  }
  if (!body) return new NextResponse("Couldn't get the photo", { status: 502 });
  name = name.replace(/["\\]/g, "");
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const isPdf = ext === "pdf" || /pdf/i.test(type);

  if (!isPdf) {
    const w = Math.min(2000, Math.max(80, Number(sp.get("w")) || 1600));
    const small = await shrinkImage(body, w, w <= 400 ? 70 : 82);
    if (small) {
      return new NextResponse(new Uint8Array(small.body), {
        headers: { "Content-Type": small.type, "Content-Disposition": `inline; filename="${name.replace(/\.[^.]+$/, "")}.jpg"`, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
      });
    }
  }
  const byExt: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
  const t = /octet-stream|^$/i.test(type) && byExt[ext] ? byExt[ext] : type;
  const safe = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)\b/i.test(t);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": safe ? t : "application/octet-stream",
      "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
