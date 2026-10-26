// AMBIT complaint reports (CCR-2026-###), started from Ask AMBIT photos or by hand.

export const SYMPTOMS = [
  { id: "shrinkage", label: "Shrinkage / pulling away" },
  { id: "cracking", label: "Cracking or splitting" },
  { id: "separation", label: "Separation from the substrate" },
  { id: "soft", label: "Soft, friable or crumbly" },
  { id: "voids", label: "Voids or large cells" },
  { id: "discoloration", label: "Discoloration or scorching" },
  { id: "odor", label: "Odor" },
  { id: "low_yield", label: "Low yield" },
  { id: "off_ratio", label: "Looks off-ratio (sticky, brittle)" },
  { id: "other", label: "Something else" },
];

export const COMPLAINT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "pill grey" },
  submitted: { label: "Submitted to AMBIT", cls: "pill warn" },
  reviewing: { label: "AMBIT is reviewing", cls: "pill warn" },
  closed: { label: "Closed", cls: "pill ok" },
};

export type Complaint = {
  id: string;
  report_no: string | null;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  company_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  job_name: string | null;
  job_address: string | null;
  product: string | null;
  lot_numbers: string | null;
  sets_used: string | null;
  date_sprayed: string | null;
  application: string | null;
  thickness: string | null;
  substrate: string | null;
  substrate_temp: string | null;
  substrate_moisture: string | null;
  ambient_temp: string | null;
  humidity: string | null;
  equipment: string | null;
  symptoms: string[];
  description: string | null;
  ai_notes: string | null;
  photos: string[];
  thread_id: string | null;
  resolution: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The text fields people fill in, in the order they appear on the form and the printed report. */
export const COMPLAINT_FIELDS: { key: keyof Complaint; label: string; group: "who" | "product" | "conditions"; wide?: boolean; type?: "date" | "area" }[] = [
  { key: "company_name", label: "Contractor / customer", group: "who" },
  { key: "contact_name", label: "Contact", group: "who" },
  { key: "contact_phone", label: "Phone", group: "who" },
  { key: "contact_email", label: "Email", group: "who" },
  { key: "job_name", label: "Job / homeowner", group: "who" },
  { key: "job_address", label: "Job address", group: "who", wide: true },
  { key: "product", label: "Product", group: "product" },
  { key: "lot_numbers", label: "Lot numbers (A and B)", group: "product" },
  { key: "sets_used", label: "Sets used", group: "product" },
  { key: "date_sprayed", label: "Date sprayed", group: "product", type: "date" },
  { key: "application", label: "Where it was sprayed", group: "product" },
  { key: "thickness", label: "Thickness / passes", group: "product" },
  { key: "substrate", label: "Substrate", group: "conditions" },
  { key: "substrate_temp", label: "Substrate temperature", group: "conditions" },
  { key: "substrate_moisture", label: "Substrate moisture", group: "conditions" },
  { key: "ambient_temp", label: "Air temperature", group: "conditions" },
  { key: "humidity", label: "Humidity", group: "conditions" },
  { key: "equipment", label: "Rig settings (A/B temps, pressure, hose heat)", group: "conditions", wide: true },
];
