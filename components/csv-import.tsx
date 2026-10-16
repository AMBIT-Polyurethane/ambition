"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { importCompanies, importProducts, type ImportResult } from "@/app/(app)/admin/actions";
import { rowsFromGrid } from "@/lib/product-import";

type Kind = "products" | "companies";

export function CsvImport({ kind }: { kind: Kind }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [hideMissing, setHideMissing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const onFile = (file: File | undefined) => {
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (res) => {
        // Title rows above the header (like the Inventory Workbook's) are skipped automatically.
        const keys = kind === "products" ? ["sku"] : ["name", "company", "customer", "account_no"];
        const parsed = rowsFromGrid(res.data as string[][], keys);
        const keyCol = kind === "products" ? "sku" : null;
        setRows(keyCol ? parsed.filter((r) => (r[keyCol] ?? "").trim() !== "") : parsed);
      },
      error: (err) => setResult({ ok: false, message: err.message }),
    });
  };

  const run = () =>
    start(async () => {
      if (!rows) return;
      const res = kind === "products" ? await importProducts(rows, hideMissing) : await importCompanies(rows);
      setResult(res);
      if (res.ok) setRows(null);
    });

  return (
    <div className="card col">
      <div className="row between wrap">
        <b>Import from a spreadsheet</b>
        <a className="small" href={`/templates/${kind === "products" ? "products" : "customers"}-template.csv`} download>
          Download the template
        </a>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {kind === "products"
          ? "Use the template, or open the Inventory Control Workbook, click the Item Master tab and choose File → Save As → CSV. Rows are matched by SKU: existing products update, new ones are added. Costs and margins are never imported. AMBIT Foam and Fiberglass show “Based on customer pricing”."
          : "Save your customer list as CSV with columns name, account_no, branch, phone, email. Matching account numbers are updated."}
      </p>
      <label className="btn dark sm" style={{ alignSelf: "flex-start" }}>
        <Upload size={16} /> {fileName || "Choose CSV file"}
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {rows ? (
        <>
          <div className="small muted">
            {rows.length} rows found. Columns: {Object.keys(rows[0] ?? {}).join(", ") || "none"}
          </div>
          {kind === "products" ? (
            <label className="check">
              <input type="checkbox" checked={hideMissing} onChange={(e) => setHideMissing(e.target.checked)} />
              Hide products that are not in this file (use this for your full product list; it removes the samples)
            </label>
          ) : null}
          <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} disabled={pending} onClick={run}>
            {pending ? "Importing…" : `Import ${rows.length} rows`}
          </button>
        </>
      ) : null}
      {result ? <div className={`alert ${result.ok ? "ok" : "err"}`}>{result.message}</div> : null}
    </div>
  );
}
