// The native forms engine: every form (credit application, account setup, RMA, travel, time off, spray data,
// contact info, the Daily Pulses) is a list of steps and fields here. The same spec draws the form, checks it in
// the browser, checks it again on the server, and lays out the read-only view and the PDF.

export type Val = string | string[] | FileRef[] | null | undefined;
export type Data = Record<string, Val>;
export type FileRef = { path: string; name: string; type?: string; size?: number };
export type Cond = (d: Data) => boolean;
export type Opt = string | { v: string; label?: string; hint?: string; pts?: number };

type Base = { k: string; label: string; req?: boolean | Cond; hint?: string; show?: Cond; w?: 1 | 2 | 3 | 4 | 6 };
export type Field =
  | (Base & { t: "text" | "email" | "tel" | "date" | "time" | "textarea" | "zip" | "state" | "ein" | "url"; ph?: string; max?: number })
  | (Base & { t: "number" | "money"; ph?: string; min?: number; max?: number; unit?: string; step?: number })
  | (Base & { t: "choice"; opts: Opt[]; multi?: boolean; style?: "cards" | "pills" | "select"; other?: boolean })
  | (Base & { t: "combo"; opts: string[]; ph?: string })
  | (Base & { t: "staff" | "customer"; ph?: string })
  | (Base & { t: "signature" })
  | (Base & { t: "file"; accept?: string; multi?: boolean })
  | (Base & { t: "secret"; kind: "ssn" | "bank" | "dl" | "ein" })
  | (Base & { t: "calc"; calc: (d: Data) => string | null })
  | { t: "note"; k: string; text: string; tone?: "info" | "legal" | "warn"; show?: Cond; label?: undefined; w?: undefined; req?: undefined }
  | { t: "head"; k: string; text: string; sub?: string; show?: Cond; label?: undefined; w?: undefined; req?: undefined };

export type Step = { key: string; title: string; sub?: string; fields: Field[]; staffOnly?: boolean; show?: Cond };
export type Score = { total: number; max: number; pct: number; parts: { label: string; pts: number; max: number }[]; flags: string[] };
export type Spec = {
  key: string;
  title: string;
  short: string;
  desc: string;
  icon: string;
  group: "customer" | "team" | "field" | "pulse";
  /** A customer can fill it from an emailed link. */
  publicLink?: boolean;
  /** A reviewer approves or denies it. */
  decide?: boolean;
  dept?: "mfg" | "lab" | "sales" | "tech" | "admin";
  steps: Step[];
  /** Who it's about, for lists ("Acme Foam · $50,000"). */
  summary: (d: Data) => string;
  score?: (d: Data) => Score;
};

export const str = (v: Val) => (typeof v === "string" ? v : Array.isArray(v) ? (v as unknown[]).map((x) => (typeof x === "string" ? x : (x as FileRef).name)).join(", ") : "");
export const arr = (v: Val): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []);
export const files = (v: Val): FileRef[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is FileRef => !!x && typeof x === "object" && "path" in (x as object)) : []);
export const num = (v: Val) => { const n = Number(str(v).replace(/[$,\s]/g, "")); return str(v).trim() === "" || !Number.isFinite(n) ? null : n; };
export const optV = (o: Opt) => (typeof o === "string" ? o : o.v);
export const optL = (o: Opt) => (typeof o === "string" ? o : o.label ?? o.v);
export const is = (k: string, v: string): Cond => (d) => (Array.isArray(d[k]) ? arr(d[k]).includes(v) : str(d[k]) === v);
export const starts = (k: string, v: string): Cond => (d) => str(d[k]).toLowerCase().startsWith(v.toLowerCase());
export const filled = (k: string): Cond => (d) => str(d[k]).trim() !== "";

export const isShown = (f: { show?: Cond }, d: Data) => !f.show || f.show(d);
export const isReq = (f: Field, d: Data) => (typeof f.req === "function" ? f.req(d) : !!f.req);
export function visibleSteps(spec: Spec, d: Data, staff: boolean) {
  return spec.steps.filter((s) => (!s.staffOnly || staff) && isShown(s, d));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** What's missing or wrong on one step (or the whole form): field key → message. */
export function check(spec: Spec, d: Data, opts: { staff: boolean; step?: string; secretsKept?: string[] }): Record<string, string> {
  const err: Record<string, string> = {};
  for (const s of visibleSteps(spec, d, opts.staff)) {
    if (opts.step && s.key !== opts.step) continue;
    for (const f of s.fields) {
      if (f.t === "note" || f.t === "head" || f.t === "calc" || !isShown(f, d)) continue;
      const v = d[f.k];
      const empty = f.t === "file" ? files(v).length === 0 : f.t === "choice" && f.multi ? arr(v).length === 0 : str(v).trim() === "";
      if (empty) {
        if (f.t === "secret" && opts.secretsKept?.includes(f.k)) continue;
        if (isReq(f, d)) err[f.k] = f.t === "signature" ? "Please sign here." : f.t === "file" ? "Please add the file." : f.t === "choice" ? "Pick one." : "Please fill this in.";
        continue;
      }
      const t = str(v).trim();
      if (f.t === "email" && !EMAIL.test(t)) err[f.k] = "That email doesn't look right.";
      if (f.t === "tel" && t.replace(/\D/g, "").length < 10) err[f.k] = "Type the full 10-digit number.";
      if (f.t === "zip" && !/^\d{5}(-\d{4})?$/.test(t)) err[f.k] = "Type a 5-digit ZIP.";
      if (f.t === "state" && !/^[A-Za-z]{2}$/.test(t)) err[f.k] = "Use the 2-letter state (TX).";
      if (f.t === "ein" && t.replace(/\D/g, "").length !== 9) err[f.k] = "A FEIN has 9 digits (12-3456789).";
      if ((f.t === "number" || f.t === "money") && num(v) === null) err[f.k] = "Type a number.";
      if ((f.t === "number" || f.t === "money") && num(v) !== null && f.min !== undefined && num(v)! < f.min) err[f.k] = `It can't be less than ${f.min}.`;
      if (f.t === "secret" && f.kind === "ssn" && t.replace(/\D/g, "").length !== 9) err[f.k] = "A Social Security number has 9 digits.";
      if (f.t === "secret" && f.kind === "bank" && !/^\d{4,17}$/.test(t.replace(/[\s-]/g, ""))) err[f.k] = "Type the account number (digits only).";
    }
  }
  return err;
}

/** Fields with private values (SSN, bank account, driver's license #): kept encrypted, never shown whole. */
export function secretFields(spec: Spec) {
  return spec.steps.flatMap((s) => s.fields).filter((f): f is Extract<Field, { t: "secret" }> => f.t === "secret");
}
export const mask = (v: string) => { const d = v.replace(/\D/g, ""); return d ? `•••• ${d.slice(-4)}` : "••••"; };

/** Keep only the fields this form has (and that are showing), trimmed. */
export function tidy(spec: Spec, d: Data, staff: boolean): Data {
  const out: Data = {};
  for (const s of visibleSteps(spec, d, staff)) for (const f of s.fields) {
    if (f.t === "note" || f.t === "head" || !isShown(f, d)) continue;
    if (f.t === "calc") { out[f.k] = f.calc(d); continue; }
    const v = d[f.k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") out[f.k] = v.trim().slice(0, f.t === "signature" ? 200000 : f.t === "textarea" ? 5000 : 300);
    else out[f.k] = Array.isArray(v) ? (v as unknown[]).slice(0, 20) as Val : v;
  }
  return out;
}

/** Plain text of one answer, for lists, emails and the PDF. */
export function answer(f: Field, d: Data): string {
  if (f.t === "note" || f.t === "head") return "";
  const v = d[f.k];
  if (f.t === "calc") return str(v) || (f.calc(d) ?? "");
  if (f.t === "signature") return str(v) ? "Signed" : "";
  if (f.t === "file") return files(v).map((x) => x.name).join(", ");
  if (f.t === "money") { const n = num(v); return n === null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
  if (f.t === "choice") {
    const label = (x: string) => { const o = f.opts.find((o) => optV(o) === x); return o ? optL(o) : x; };
    return arr(v).map(label).join(", ");
  }
  return str(v);
}
