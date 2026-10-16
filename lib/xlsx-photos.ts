"use client";

import { unzipSync, strFromU8 } from "fflate";
import { RASTER } from "@/lib/images";

const NS = {
  main: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  pkg: "http://schemas.openxmlformats.org/package/2006/relationships",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
};

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

function xml(files: Record<string, Uint8Array>, path: string): Document | null {
  const f = files[path];
  return f ? new DOMParser().parseFromString(strFromU8(f), "application/xml") : null;
}

function resolve(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function rels(files: Record<string, Uint8Array>, ofPath: string): Map<string, { target: string; type: string }> {
  const dir = ofPath.split("/").slice(0, -1).join("/");
  const name = ofPath.split("/").pop();
  const doc = xml(files, `${dir}/_rels/${name}.rels`);
  const out = new Map<string, { target: string; type: string }>();
  if (!doc) return out;
  for (const r of Array.from(doc.getElementsByTagNameNS(NS.pkg, "Relationship"))) {
    out.set(r.getAttribute("Id") ?? "", { target: resolve(ofPath, r.getAttribute("Target") ?? ""), type: r.getAttribute("Type") ?? "" });
  }
  return out;
}

function colOf(ref: string): string {
  return ref.replace(/\d+/g, "");
}

export type WorkbookPhoto = { sku: string; blob: Blob; media: string };

// Finds pictures placed on rows of the products sheet and pairs each with that row's SKU.
export function extractWorkbookPhotos(buf: ArrayBuffer, preferredSheets: readonly string[]): WorkbookPhoto[] {
  const files = unzipSync(new Uint8Array(buf), {
    filter: (f) => f.name.startsWith("xl/") && (/\.(xml|rels)$/.test(f.name) || f.name.includes("/media/")),
  });
  const wb = xml(files, "xl/workbook.xml");
  if (!wb) return [];
  const wbRels = rels(files, "xl/workbook.xml");
  const sheets = Array.from(wb.getElementsByTagNameNS(NS.main, "sheet")).map((s) => ({
    name: (s.getAttribute("name") ?? "").trim(),
    path: wbRels.get(s.getAttributeNS(NS.rel, "id") ?? "")?.target ?? "",
  }));
  const sheet = sheets.find((s) => preferredSheets.includes(s.name.toLowerCase())) ?? sheets[0];
  if (!sheet?.path) return [];

  // Shared strings
  const sstDoc = xml(files, "xl/sharedStrings.xml");
  const sst = sstDoc
    ? Array.from(sstDoc.getElementsByTagNameNS(NS.main, "si")).map((si) =>
        Array.from(si.getElementsByTagNameNS(NS.main, "t")).map((t) => t.textContent ?? "").join(""),
      )
    : [];

  // Cell text by row for the SKU column
  const sheetDoc = xml(files, sheet.path);
  if (!sheetDoc) return [];
  const textOf = (c: Element): string => {
    const t = c.getAttribute("t");
    if (t === "inlineStr") return Array.from(c.getElementsByTagNameNS(NS.main, "t")).map((x) => x.textContent ?? "").join("");
    const v = c.getElementsByTagNameNS(NS.main, "v")[0]?.textContent ?? "";
    return t === "s" ? sst[Number(v)] ?? "" : v;
  };
  let skuCol = "";
  const rowText = new Map<number, Map<string, string>>();
  for (const row of Array.from(sheetDoc.getElementsByTagNameNS(NS.main, "row"))) {
    const r = Number(row.getAttribute("r"));
    const cells = new Map<string, string>();
    for (const c of Array.from(row.getElementsByTagNameNS(NS.main, "c"))) {
      const ref = c.getAttribute("r") ?? "";
      const text = textOf(c).trim();
      cells.set(colOf(ref), text);
      if (!skuCol && r <= 30 && text.toLowerCase() === "sku") skuCol = colOf(ref);
    }
    rowText.set(r, cells);
  }
  if (!skuCol) return [];

  // Drawing attached to the sheet
  const drawing = Array.from(rels(files, sheet.path).values()).find((r) => r.type.endsWith("/drawing"));
  if (!drawing) return [];
  const drawDoc = xml(files, drawing.target);
  if (!drawDoc) return [];
  const drawRels = rels(files, drawing.target);

  const out: WorkbookPhoto[] = [];
  const seen = new Set<string>();
  const anchors = ["twoCellAnchor", "oneCellAnchor"].flatMap((n) => Array.from(drawDoc.getElementsByTagNameNS(NS.xdr, n)));
  for (const a of anchors) {
    const from = a.getElementsByTagNameNS(NS.xdr, "from")[0];
    const row = Number(from?.getElementsByTagNameNS(NS.xdr, "row")[0]?.textContent ?? "-1") + 1;
    const blip = a.getElementsByTagNameNS(NS.a, "blip")[0];
    const media = drawRels.get(blip?.getAttributeNS(NS.rel, "embed") ?? "")?.target ?? "";
    const sku = rowText.get(row)?.get(skuCol)?.trim() ?? "";
    if (!sku || !media || !RASTER.test(media) || !files[media] || seen.has(sku.toLowerCase())) continue;
    seen.add(sku.toLowerCase());
    const ext = (media.split(".").pop() ?? "png").toLowerCase();
    const bytes = files[media];
    out.push({ sku, blob: new Blob([bytes.slice().buffer], { type: MIME[ext] ?? "image/png" }), media });
  }
  return out;
}
