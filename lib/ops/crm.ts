// AMBIT-OPS CRM: customers, properties, leads and their notes (types and small helpers, safe anywhere).

export type OpsCustomer = {
  id: string;
  company_id: string;
  kind: "person" | "company";
  name: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  notes: string | null;
  source: string | null;
  price_level: "retail" | "builder";
  tax_exempt: boolean;
  import_batch: string | null;
  created_at: string;
};

export type OpsProperty = {
  id: string;
  customer_id: string;
  label: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  gate_code: string | null;
};

export type OpsLead = {
  id: string;
  number: number;
  customer_id: string;
  property_id: string | null;
  location_id: string | null;
  title: string | null;
  stage: string;
  source: string | null;
  services: string[];
  rep_id: string | null;
  value_est: number | null;
  notes: string | null;
  next_at: string | null;
  lost_reason: string | null;
  stage_changed_at: string;
  won_at: string | null;
  lost_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OpsNote = {
  id: string;
  lead_id: string | null;
  customer_id: string | null;
  kind: "note" | "call" | "email" | "text" | "task" | "stage" | "system";
  body: string;
  due_on: string | null;
  done_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type TeamMember = { id: string; full_name: string | null; email: string; ops_role: string | null; phone: string | null };

export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** "(580) 554-1971" for a 10-digit US number, else as typed. */
export function phoneText(s: string | null | undefined) {
  const d = digits(s);
  const t = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : (s ?? "");
}

export const addressLine = (p: Pick<OpsProperty, "street" | "city" | "state" | "zip"> | null | undefined) =>
  p ? [p.street, [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";

export const mapsUrl = (p: Pick<OpsProperty, "street" | "city" | "state" | "zip"> | null | undefined) =>
  `https://maps.apple.com/?q=${encodeURIComponent(addressLine(p))}`;

export const memberName = (m: Pick<TeamMember, "full_name" | "email"> | null | undefined) => (m ? m.full_name || m.email.split("@")[0] : "");

/** Days since a date (whole days, never negative). */
export const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));

/** A stage change note is stored as "from>to" (or "from>lost:Reason"). */
export function stageNote(body: string): { from: string; to: string; reason: string | null } | null {
  const m = /^([^>]+)>([^:]+)(?::(.*))?$/.exec(body);
  return m ? { from: m[1], to: m[2], reason: m[3] ?? null } : null;
}

export const NOTE_KINDS = [
  { key: "note", label: "Note" },
  { key: "call", label: "Call" },
  { key: "text", label: "Text" },
  { key: "email", label: "Email" },
] as const;

export const money0 = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
