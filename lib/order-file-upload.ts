"use client";

import { createClient } from "@/lib/supabase/client";
import { shrink } from "@/lib/photo-upload";

// Invoices and signed BOLs: saved in the private "order-files" bucket under the order's folder.
// Photos are made smaller on the phone first (longest side 2400 px, still sharp enough to read a signature).

export type OrderUpload = { path: string; name: string };

const MAX = 25 * 1024 * 1024;

export async function uploadOrderFiles(orderId: string, kind: "invoice" | "bol", files: File[]): Promise<{ ok: OrderUpload[]; error: string | null }> {
  const supabase = createClient();
  const ok: OrderUpload[] = [];
  for (const f of files) {
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    const isImg = f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
    if (!isPdf && !isImg) return { ok, error: `${f.name}: use a PDF or a photo.` };
    let body: Blob = f;
    let type = isPdf ? "application/pdf" : f.type || "image/jpeg";
    if (isImg) {
      body = await shrink(f, 2400, 0.85);
      if (body !== f) type = "image/jpeg";
    }
    if (body.size > MAX) return { ok, error: `${f.name} is over 25 MB.` };
    const ext = isPdf ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : /hei[cf]/i.test(type) ? "heic" : "jpg";
    const path = `${orderId}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const up = await supabase.storage.from("order-files").upload(path, body, { contentType: type, upsert: false });
    if (up.error) return { ok, error: `${f.name}: couldn't upload (${up.error.message}).` };
    ok.push({ path, name: f.name });
  }
  return { ok, error: null };
}
