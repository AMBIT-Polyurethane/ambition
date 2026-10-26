// Sales-tax exemption certificates (supabase/migrations/0021). Shared by the server pages and the
// daily reminder job.

export type TaxState = "taxable" | "ok" | "expiring" | "expired" | "pending" | "missing";

export const TAX_STATE: Record<TaxState, { label: string; cls: string; blocks: boolean }> = {
  taxable: { label: "Not tax-exempt", cls: "pill grey", blocks: false },
  ok: { label: "Certificate current", cls: "pill ok", blocks: false },
  expiring: { label: "Expires soon", cls: "pill warn", blocks: false },
  expired: { label: "Certificate expired", cls: "pill", blocks: true },
  pending: { label: "Waiting for Accounting to verify", cls: "pill warn", blocks: true },
  missing: { label: "No certificate on file", cls: "pill", blocks: true },
};

export const CERT_KINDS = [
  { id: "resale", label: "Resale / sales tax permit" },
  { id: "exempt_org", label: "Exempt organization" },
  { id: "agriculture", label: "Agriculture" },
  { id: "government", label: "Government" },
  { id: "other", label: "Other" },
];

export const CERT_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting to verify", cls: "pill warn" },
  verified: { label: "Verified", cls: "pill ok" },
  rejected: { label: "Turned down", cls: "pill" },
  replaced: { label: "Replaced", cls: "pill grey" },
};

export const US_STATES = ["OK", "TX", "FL", "AL", "AR", "KS", "LA", "MO", "MS", "GA", "NM", "CO", "TN", "Other"];

export type TaxInfo = { state: TaxState; expires_on: string | null; days_left: number | null; cert_id: string | null; pending: number };

export type CertRow = {
  id: string;
  company_id: string;
  state: string | null;
  cert_number: string | null;
  kind: string | null;
  issued_on: string | null;
  expires_on: string | null;
  no_expiration: boolean;
  file_path: string | null;
  file_name: string | null;
  status: string;
  note: string | null;
  uploaded_by_name: string | null;
  uploaded_by_role: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  remind_60_at?: string | null;
  remind_30_at?: string | null;
  remind_expired_at?: string | null;
  created_at: string;
};

/** Same rules as public.company_tax_state, for jobs that run without a signed-in person. */
export function computeTaxState(exempt: boolean, certs: CertRow[], today: string): TaxInfo {
  const pending = certs.filter((c) => c.status === "pending").length;
  const verified = certs
    .filter((c) => c.status === "verified")
    .sort((a, b) => Number(b.no_expiration) - Number(a.no_expiration) || String(b.expires_on ?? "9999").localeCompare(String(a.expires_on ?? "9999")));
  const v = verified[0];
  const days = (d: string) => Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
  if (!exempt) return { state: "taxable", expires_on: null, days_left: null, cert_id: null, pending };
  if (v && (v.no_expiration || !v.expires_on || v.expires_on >= today)) {
    const left = v.no_expiration || !v.expires_on ? null : days(v.expires_on);
    return { state: left !== null && left <= 60 ? "expiring" : "ok", expires_on: v.expires_on, days_left: left, cert_id: v.id, pending };
  }
  if (v) return { state: pending ? "pending" : "expired", expires_on: v.expires_on, days_left: v.expires_on ? days(v.expires_on) : null, cert_id: v.id, pending };
  if (pending) return { state: "pending", expires_on: null, days_left: null, cert_id: null, pending };
  return { state: "missing", expires_on: null, days_left: null, cert_id: null, pending: 0 };
}

/** One line about where a customer stands, for flags and lists. */
export function taxLine(t: TaxInfo, dateShort: (d: string) => string): string {
  switch (t.state) {
    case "expired":
      return `Tax-exempt certificate expired${t.expires_on ? ` ${dateShort(t.expires_on)}` : ""}`;
    case "expiring":
      return `Tax-exempt certificate expires ${t.expires_on ? dateShort(t.expires_on) : "soon"} (${t.days_left} day${t.days_left === 1 ? "" : "s"})`;
    case "pending":
      return "New tax-exempt certificate waiting for Accounting to verify";
    case "missing":
      return "Marked tax-exempt, but no certificate is on file";
    case "ok":
      return t.expires_on ? `Tax-exempt certificate good through ${dateShort(t.expires_on)}` : "Tax-exempt certificate on file (no expiration)";
    default:
      return "Not tax-exempt";
  }
}
