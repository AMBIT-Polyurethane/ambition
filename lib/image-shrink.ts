import "server-only";

/**
 * Makes a phone photo small enough for a page or a PDF (JPEG, longest side `max` px, turned the right way up).
 * Gives back the original when it isn't a picture this can read (a PDF receipt, an iPhone HEIC photo).
 */
export async function shrinkImage(input: ArrayBuffer | Buffer, max: number, quality = 72): Promise<{ body: Buffer; type: string } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const body = await sharp(Buffer.from(input as ArrayBuffer), { failOn: "none" })
      .rotate()
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { body, type: "image/jpeg" };
  } catch {
    return null;
  }
}
