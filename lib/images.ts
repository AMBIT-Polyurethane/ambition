"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export const RASTER = /\.(png|jpe?g|gif|webp|bmp)$/i;

// Shrinks a photo to at most `max` px on its longest side and saves it as a JPEG on white.
export async function toJpeg(blob: Blob, max = 640, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not convert the image"))), "image/jpeg", quality),
  );
}

export function photoPath(sku: string): string {
  const slug = sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
  return `p/${slug}.jpg`;
}

// Uploads (or replaces) a product's photo and returns its public address.
export async function uploadProductPhoto(supabase: SupabaseClient, sku: string, jpeg: Blob): Promise<string> {
  const path = photoPath(sku);
  const { error } = await supabase.storage.from("product-images").upload(path, jpeg, {
    contentType: "image/jpeg",
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

// Runs async jobs a few at a time and reports progress.
export async function runPool<T>(items: T[], size: number, job: (item: T) => Promise<void>, onDone: (done: number) => void) {
  let i = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await job(item);
      } finally {
        onDone(++done);
      }
    }
  });
  await Promise.all(workers);
}
