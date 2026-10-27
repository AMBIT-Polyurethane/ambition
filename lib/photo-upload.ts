"use client";

import { createClient } from "@/lib/supabase/client";

// Photos taken in the app (Ask AMBIT, order intake, complaint reports): made smaller on the phone first
// (longest side 1600 px, JPEG), then saved in the private "photos" bucket under the person's own folder.

export async function shrink(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

export type Uploaded = { path: string; url: string };

/** Saves photos; gives back their paths (for the server) and local preview links. */
export async function uploadPhotos(files: File[], folder: string): Promise<{ ok: Uploaded[]; errors: string[] }> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return { ok: [], errors: ["Sign in again to add photos."] };
  const ok: Uploaded[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) {
      errors.push(`${f.name}: only photos can be added.`);
      continue;
    }
    const body = await shrink(f);
    const type = body.type === "image/png" || body.type === "image/webp" ? body.type : "image/jpeg";
    if (body.size > 15 * 1024 * 1024) {
      errors.push(`${f.name}: too large.`);
      continue;
    }
    const path = `${uid}/${folder}/${crypto.randomUUID()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
    const up = await supabase.storage.from("photos").upload(path, body, { contentType: type, upsert: false });
    if (up.error) {
      errors.push(`${f.name}: couldn't upload (${up.error.message}).`);
      continue;
    }
    ok.push({ path, url: URL.createObjectURL(body) });
  }
  return { ok, errors };
}
