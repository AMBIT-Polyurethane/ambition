"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { importCompanies, importProducts, type ImportResult } from "@/app/(app)/admin/actions";

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
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (res) => setRows(res.data),
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
          ? "Save your product list as CSV (Excel: File → Save As → CSV) with columns sku, name, description, category, unit, list_price. Existing SKUs are updated; new ones are added. Spray foam and fiberglass categories show “Based on customer pricing”."
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
