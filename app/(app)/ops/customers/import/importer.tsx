"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { CircleCheck, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { existingContacts, importCustomers, type ImportRow } from "../../crm-actions";
import { digits, phoneText } from "@/lib/ops/crm";

// AMBIT-OPS: bring a customer list in from a spreadsheet. Columns are matched automatically (and can be
// changed), every row is shown first, and repeats (same phone or email) are skipped unless kept.

const FIELDS = [
  { key: "name", label: "Customer name", alias: ["name", "customer", "customer name", "full name", "display name", "contact", "contact name", "client", "client name"] },
  { key: "first_name", label: "First name", alias: ["first", "first name", "firstname", "given name"] },
  { key: "last_name", label: "Last name", alias: ["last", "last name", "lastname", "surname", "family name"] },
  { key: "company_name", label: "Company", alias: ["company", "company name", "business", "business name", "builder", "organization"] },
  { key: "phone", label: "Phone", alias: ["phone", "mobile", "cell", "phone number", "mobile phone", "main phone", "telephone", "cell phone", "primary phone"] },
  { key: "email", label: "Email", alias: ["email", "e-mail", "email address", "main email", "primary email"] },
  { key: "street", label: "Street address", alias: ["address", "street", "street address", "address 1", "address line 1", "billing address", "service address", "property address", "billing street"] },
  { key: "city", label: "City", alias: ["city", "billing city", "town"] },
  { key: "state", label: "State", alias: ["state", "st", "billing state", "province"] },
  { key: "zip", label: "ZIP", alias: ["zip", "zip code", "zipcode", "postal", "postal code", "billing zip"] },
  { key: "notes", label: "Notes", alias: ["notes", "note", "comments", "memo"] },
  { key: "source", label: "Lead source", alias: ["source", "lead source", "referral", "referred by"] },
] as const;
type Key = (typeof FIELDS)[number]["key"];

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
const cell = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();

async function readFile(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    const best = sheets.find((s) => (s.data as unknown[][]).length > 1) ?? sheets[0];
    return (best.data as unknown[][]).map((r) => r.map(cell));
  }
  const text = await file.text();
  return (Papa.parse<string[]>(text, { header: false, skipEmptyLines: true }).data as string[][]).map((r) => r.map(cell));
}

/** The header row is the first one in the top 10 with two or more names we recognize. */
function findHeader(grid: string[][]) {
  const known = new Set(FIELDS.flatMap((f) => f.alias as readonly string[]));
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    if (grid[i].filter((c) => known.has(norm(c))).length >= 2) return i;
  }
  return 0;
}

/** "123 Main St, Tulsa, OK 74101" → parts, when the sheet keeps the whole address in one cell. */
function splitAddress(a: string) {
  const m = /^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\.?\s*(\d{5}(?:-\d{4})?)?\s*$/.exec(a.trim());
  return m ? { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] ?? "" } : null;
}

type Prepared = ImportRow & { line: number; repeat: "file" | "existing" | null };

export function CustomerImport() {
  const [file, setFile] = useState("");
  const [head, setHead] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<Key, number>>({} as Record<Key, number>);
  const [known, setKnown] = useState<{ phones: Set<string>; emails: Set<string> }>({ phones: new Set(), emails: new Set() });
  const [keepRepeats, setKeepRepeats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ customers: number; properties: number } | null>(null);
  const [pending, start] = useTransition();

  const onFile = (f: File | undefined) => {
    setError(null);
    setDone(null);
    if (!f) return;
    setFile(f.name);
    start(async () => {
      try {
        const [grid, ex] = await Promise.all([readFile(f), existingContacts()]);
        const h = findHeader(grid);
        const header = grid[h] ?? [];
        const auto = {} as Record<Key, number>;
        for (const fl of FIELDS) {
          const i = header.findIndex((c) => (fl.alias as readonly string[]).includes(norm(c)));
          auto[fl.key] = i;
        }
        setHead(header);
        setBody(grid.slice(h + 1).filter((r) => r.some((c) => c)));
        setMap(auto);
        setKnown({ phones: new Set(ex.phones), emails: new Set(ex.emails) });
      } catch {
        setError("Couldn't read that file. Save it as .xlsx or .csv and try again.");
      }
    });
  };

  const rows: Prepared[] = useMemo(() => {
    const seenP = new Set<string>();
    const seenE = new Set<string>();
    const get = (r: string[], k: Key) => (map[k] >= 0 ? (r[map[k]] ?? "").trim() : "");
    return body.map((r, i) => {
      const first = get(r, "first_name");
      const last = get(r, "last_name");
      const company = get(r, "company_name");
      const person = [first, last].filter(Boolean).join(" ");
      const name = get(r, "name") || person || company;
      const kind: "person" | "company" = !person && company && (!get(r, "name") || get(r, "name") === company) ? "company" : "person";
      let street = get(r, "street");
      let city = get(r, "city");
      let state = get(r, "state");
      let zip = get(r, "zip");
      if (street && !city) {
        const sp = splitAddress(street);
        if (sp) ({ street, city, state, zip } = { ...sp, zip: sp.zip || zip });
      }
      const phone = get(r, "phone");
      const email = get(r, "email").toLowerCase();
      const d = digits(phone).slice(-10);
      let repeat: Prepared["repeat"] = null;
      if ((d.length >= 7 && known.phones.has(d)) || (email && known.emails.has(email))) repeat = "existing";
      else if ((d.length >= 7 && seenP.has(d)) || (email && seenE.has(email))) repeat = "file";
      if (d.length >= 7) seenP.add(d);
      if (email) seenE.add(email);
      return {
        line: i + 1,
        repeat,
        name,
        kind,
        first_name: kind === "person" ? first || undefined : undefined,
        last_name: kind === "person" ? last || undefined : undefined,
        company_name: company || undefined,
        email: email || undefined,
        phone: phone || undefined,
        street: street || undefined,
        city: city || undefined,
        state: state.length === 2 ? state.toUpperCase() : undefined,
        zip: zip || undefined,
        notes: get(r, "notes") || undefined,
        source: get(r, "source") || undefined,
      };
    });
  }, [body, map, known]);

  const usable = rows.filter((r) => r.name);
  const repeats = usable.filter((r) => r.repeat);
  const toImport = usable.filter((r) => keepRepeats || !r.repeat);
  const noName = rows.length - usable.length;

  const run = () =>
    start(async () => {
      setError(null);
      const res = await importCustomers(toImport.map(({ line: _l, repeat: _r, ...x }) => x));
      if (!res.ok) setError(res.error ?? "The import didn't go through.");
      else setDone({ customers: res.customers ?? 0, properties: res.properties ?? 0 });
    });

  if (done) {
    return (
      <div className="col" style={{ gap: 12 }}>
        <div className="alert ok" role="status">
          <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>Imported <b>{done.customers}</b> customers with <b>{done.properties}</b> addresses. If anything looks off, &ldquo;Undo that import&rdquo; is on the Customers page for the next 3 days.</span>
        </div>
        <Link href="/ops/customers" className="btn" style={{ alignSelf: "flex-start" }}>See your customers</Link>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <label className="ops-drop">
        <input type="file" accept=".xlsx,.csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <FileSpreadsheet size={26} />
        <b>{file || "Choose a spreadsheet"}</b>
        <span className="tiny faint">{pending && !body.length ? "Reading…" : ".xlsx or .csv, up to 5,000 customers"}</span>
        <span className="btn sm dark"><Upload size={15} /> {file ? "Choose a different file" : "Choose file"}</span>
      </label>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}

      {body.length ? (
        <>
          <section className="card col" style={{ gap: 10 }}>
            <b>Match the columns</b>
            <span className="tiny faint">We matched what we could. Change any that are wrong; pick &ldquo;Not in my file&rdquo; to skip one.</span>
            <div className="ops-map">
              {FIELDS.map((f) => (
                <label key={f.key} className="field">
                  <span className="label">{f.label}</span>
                  <select className="select sm" value={map[f.key] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [f.key]: Number(e.target.value) }))}>
                    <option value={-1}>Not in my file</option>
                    {head.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="card col" style={{ gap: 10 }}>
            <div className="row wrap between" style={{ gap: 8 }}>
              <b>{usable.length} customers found</b>
              <span className="tiny faint">{[noName ? `${noName} ${noName === 1 ? "row without a name is" : "rows without a name are"} skipped` : null, repeats.length ? `${repeats.length} ${repeats.length === 1 ? "repeat" : "repeats"}` : null].filter(Boolean).join(" · ")}</span>
            </div>
            {repeats.length ? (
              <div className="alert warn small" style={{ alignItems: "center" }}>
                <TriangleAlert size={16} style={{ flex: "none" }} />
                <span className="grow">{repeats.length} {repeats.length === 1 ? "row has" : "rows have"} a phone or email that&apos;s already a customer (or appears twice in the file). They&apos;re skipped.</span>
                <label className="check small"><input type="checkbox" checked={keepRepeats} onChange={(e) => setKeepRepeats(e.target.checked)} /> Import them anyway</label>
              </div>
            ) : null}
            <div className="tbl-wrap">
              <table className="ops-table">
                <thead>
                  <tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th></th></tr>
                </thead>
                <tbody>
                  {usable.slice(0, 200).map((r) => (
                    <tr key={r.line} className={r.repeat && !keepRepeats ? "skip" : ""}>
                      <td><b>{r.name}</b>{r.kind === "company" ? <span className="tiny faint"> · company</span> : null}</td>
                      <td>{r.phone ? phoneText(r.phone) : ""}</td>
                      <td>{r.email}</td>
                      <td>{[r.street, r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</td>
                      <td className="tiny">{r.repeat === "existing" ? "Already a customer" : r.repeat === "file" ? "Twice in file" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {usable.length > 200 ? <span className="tiny faint">Showing the first 200 of {usable.length}.</span> : null}
          </section>
          <button type="button" className="btn" disabled={pending || !toImport.length} onClick={run} style={{ alignSelf: "flex-start" }}>
            {pending ? "Importing…" : `Import ${toImport.length} customers`}
          </button>
        </>
      ) : null}
    </div>
  );
}
