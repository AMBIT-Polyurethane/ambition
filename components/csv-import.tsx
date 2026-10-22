"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { importCompanies, importProducts, setProductImages, type ImportResult } from "@/app/(app)/admin/actions";
import { createClient } from "@/lib/supabase/client";
import { runPool, toJpeg, uploadProductPhoto } from "@/lib/images";
import type { WorkbookPhoto } from "@/lib/xlsx-photos";
import {
  CUSTOMER_KEYS, CUSTOMER_PRICED_CATEGORIES, PRODUCT_KEYS, cellText, normalizeProductRows, pick, rowsFromGrid, type ProductRow,
} from "@/lib/product-import";
import { money } from "@/lib/format";

type Kind = "products" | "companies";

const CONFIG = {
  products: {
    base: "products",
    keyHeaders: ["sku"],
    preferredSheets: ["item master", "products"],
    keys: PRODUCT_KEYS,
    help:
      "Start from the Excel template, or upload the AMBIT Inventory Control Workbook as-is (the Item Master tab is read automatically). Products are matched by SKU: existing ones update, new ones are added. Costs, margins and vendor details are never sent to the app.",
  },
  companies: {
    base: "customers",
    keyHeaders: ["name", "company", "customer", "account_no"],
    preferredSheets: ["customers"],
    keys: CUSTOMER_KEYS,
    help:
      "Start from the Excel template: one row per customer company with its account number, contact, billing and shipping address and home branch (OKC, ATX, SMX, JAX or MOB). Customers are matched by QuickBooks ID, then account number, then name: matches are updated, the rest are added.",
  },
} as const;

async function readGrid(file: File, kind: Kind): Promise<{ grid: string[][]; sheet: string | null }> {
  const cfg = CONFIG[kind];
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    const toGrid = (data: unknown[][]) => data.map((row) => row.map(cellText));
    const named = sheets.find((s) => (cfg.preferredSheets as readonly string[]).includes(s.sheet.trim().toLowerCase()));
    const withHeader = sheets.find((s) =>
      (s.data as unknown[][]).slice(0, 15).some((row) => row.some((c) => (cfg.keyHeaders as readonly string[]).includes(cellText(c).trim().toLowerCase().replace(/\s+/g, "_")))),
    );
    const chosen = named ?? withHeader ?? sheets[0];
    return { grid: toGrid(chosen.data as unknown[][]), sheet: chosen.sheet };
  }
  const text = await file.text();
  const res = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  return { grid: res.data as string[][], sheet: null };
}

export function CsvImport({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [preview, setPreview] = useState<ProductRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [hideMissing, setHideMissing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reading, setReading] = useState(false);
  const [photos, setPhotos] = useState<WorkbookPhoto[]>([]);
  const [withPhotos, setWithPhotos] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onFile = async (file: File | undefined) => {
    setResult(null);
    setRows(null);
    setPreview(null);
    setPhotos([]);
    if (!file) return;
    setFileName(file.name);
    setReading(true);
    try {
      const { grid, sheet } = await readGrid(file, kind);
      setSheetName(sheet);
      let parsed = pick(rowsFromGrid(grid, [...cfg.keyHeaders]), [...cfg.keys]);
      if (kind === "products") {
        parsed = parsed.filter((r) => (r.sku ?? "").trim() !== "" && !/^example/i.test((r.sku ?? "").trim()));
        setPreview(normalizeProductRows(parsed).products);
        if (/\.xlsx$/i.test(file.name)) {
          try {
            const { extractWorkbookPhotos } = await import("@/lib/xlsx-photos");
            const skus = new Set(parsed.map((r) => (r.sku ?? "").trim().toLowerCase()));
            const found = extractWorkbookPhotos(await file.arrayBuffer(), cfg.preferredSheets).filter((ph) => skus.has(ph.sku.toLowerCase()));
            setPhotos(found);
          } catch {
            setPhotos([]);
          }
        }
      } else {
        parsed = parsed.filter((r) => (r.name || r.company || r.customer || "").trim() !== "" && !/^example/i.test(r.name || r.company || r.customer || ""));
      }
      if (parsed.length === 0) {
        setResult({ ok: false, message: "No rows found. Check that the file has a header row with the template's column names and at least one row filled in." });
      } else {
        setRows(parsed);
      }
    } catch (e) {
      setResult({ ok: false, message: `Couldn't read that file: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setReading(false);
    }
  };

  const run = () =>
    start(async () => {
      if (!rows) return;
      let res = kind === "products" ? await importProducts(rows, hideMissing) : await importCompanies(rows);
      if (res.ok && kind === "products" && withPhotos && photos.length) {
        const supabase = createClient();
        const resized = new Map<string, Promise<Blob>>();
        const saved: { sku: string; url: string }[] = [];
        let failed = 0;
        await runPool(photos, 4, async (ph) => {
          try {
            if (!resized.has(ph.media)) resized.set(ph.media, toJpeg(ph.blob));
            saved.push({ sku: ph.sku, url: await uploadProductPhoto(supabase, ph.sku, await resized.get(ph.media)!) });
          } catch {
            failed++;
          }
        }, (n) => setProgress(`Uploading photos ${n} of ${photos.length}…`));
        setProgress(null);
        const ph = saved.length ? await setProductImages(saved) : { ok: false, message: "No photos could be uploaded." };
        res = {
          ok: res.ok && ph.ok,
          message: `${res.message} ${ph.message}${failed ? ` ${failed} photos failed to upload.` : ""}`,
        };
      }
      setResult(res);
      if (res.ok) {
        setPhotos([]);
        setRows(null);
        setPreview(null);
      }
    });

  const isCp = (p: ProductRow) => p.customer_priced ?? CUSTOMER_PRICED_CATEGORIES.includes((p.categoryName ?? "").toLowerCase());
  const stats = preview
    ? {
        count: preview.length,
        cats: new Set(preview.map((p) => p.categoryName ?? "")).size,
        noPrice: preview.filter((p) => p.list_price === null && !isCp(p)).length,
        cp: preview.filter(isCp).length,
        guessed: preview.filter((p) => p.unitInferred).length,
        hidden: preview.filter((p) => !p.active).length,
      }
    : null;

  return (
    <div className="card col">
      <div className="row between wrap">
        <b>Import from a spreadsheet</b>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{cfg.help}</p>

      <div className="col tight">
        <span className="label">Need a starting file?</span>
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn sm dark" href={`/templates/${cfg.base}-template.xlsx`} download>
            <FileSpreadsheet size={16} /> Excel template
          </a>
          <a className="btn sm dark" href={`/templates/${cfg.base}-blank.csv`} download>
            <Download size={16} /> Blank CSV
          </a>
          <a className="btn sm dark" href={`/templates/${cfg.base}-example.csv`} download>
            <Download size={16} /> Example CSV
          </a>
        </div>
      </div>

      <label className="btn sm" style={{ alignSelf: "flex-start" }}>
        <Upload size={16} /> {reading ? "Reading…" : fileName || "Upload Excel or CSV"}
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {rows ? (
        <>
          {stats ? (
            <div className="small muted">
              <b style={{ color: "#fff" }}>{stats.count} products</b> in {stats.cats} categories{sheetName ? ` (from the “${sheetName}” sheet)` : ""}
              {stats.cp ? ` · ${stats.cp} at customer pricing` : ""}
              {stats.noPrice ? ` · ${stats.noPrice} without a list price` : ""}
              {stats.guessed ? ` · ${stats.guessed} ${stats.guessed === 1 ? "unit" : "units"} guessed from the description` : ""}
              {stats.hidden ? ` · ${stats.hidden} marked inactive` : ""}
            </div>
          ) : (
            <div className="small muted"><b style={{ color: "#fff" }}>{rows.length} customers</b> found{sheetName ? ` (from the “${sheetName}” sheet)` : ""}</div>
          )}

          <div className="scroll-x">
            <table className="table">
              <thead>
                {kind === "products" ? (
                  <tr><th>SKU</th><th>Name</th><th>Category</th><th>Unit</th><th>List price</th></tr>
                ) : (
                  <tr><th>Name</th><th>Account #</th><th>Branch</th><th>Phone</th><th>Email</th></tr>
                )}
              </thead>
              <tbody>
                {kind === "products"
                  ? (preview ?? []).slice(0, 8).map((p) => (
                      <tr key={p.sku}>
                        <td className="nowrap">{p.sku}</td>
                        <td>{p.name}</td>
                        <td>{p.categoryName ?? "-"}</td>
                        <td>{p.unit}{p.unitInferred ? <span className="faint"> (guessed)</span> : null}</td>
                        <td className="nowrap">{isCp(p) ? <span className="cp-tag" style={{ marginTop: 0 }}>Customer pricing</span> : p.list_price === null ? <span className="faint">-</span> : money(p.list_price)}</td>
                      </tr>
                    ))
                  : rows.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        <td>{r.name || r.company || r.customer}</td>
                        <td>{r.account_no || r.account || r["account_#"] || "-"}</td>
                        <td>{(r.branch || r.default_branch || "-").toUpperCase()}</td>
                        <td>{r.phone || "-"}</td>
                        <td>{r.email || "-"}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {rows.length > 8 ? <div className="tiny faint">Showing the first 8 of {rows.length}.</div> : null}

          {photos.length ? (
            <label className="check">
              <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
              Also import the {photos.length} product photos in this file
            </label>
          ) : null}
          {kind === "products" ? (
            <label className="check">
              <input type="checkbox" checked={hideMissing} onChange={(e) => setHideMissing(e.target.checked)} />
              Hide products that are not in this file (use this when the file is your complete list)
            </label>
          ) : null}
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn sm" disabled={pending} onClick={run}>
              {pending ? progress ?? "Importing…" : `Import ${rows.length} ${kind === "products" ? "products" : "customers"}`}
            </button>
            <button type="button" className="btn sm dark" disabled={pending} onClick={() => { setRows(null); setPreview(null); setFileName(""); }}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {result ? <div className={`alert ${result.ok ? "ok" : "err"}`}>{result.message}</div> : null}
    </div>
  );
}
