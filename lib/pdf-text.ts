"use client";

// Reads the words out of a PDF in the browser (the same pdf.js Takeoff uses), page by page.
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let load: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  load ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return load;
}

export async function pdfPagesText(data: ArrayBuffer, onPage?: (page: number, of: number) => void): Promise<{ page: number; text: string }[]> {
  const m = await pdfjs();
  const doc = await m.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const out: { page: number; text: string }[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onPage?.(i, doc.numPages);
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let text = "";
      for (const item of tc.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : item.str && !item.str.endsWith(" ") ? " " : "";
      }
      out.push({ page: i, text: text.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim() });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
