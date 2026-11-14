// The smart Price Request: product lines, which items each line quotes, and how each is priced.

export const PRODUCT_LINES = [
  { key: "insulation", label: "Insulation Foam", hint: "AMBI-SEAL open-cell, AMBI-TITE closed-cell + ISO" },
  { key: "roofing", label: "Roofing Foam", hint: "AMBI-ROOF + ISO" },
  { key: "lifting", label: "Lifting Foam", hint: "AMBI-JACK + ISO" },
  { key: "fiberglass", label: "Fiberglass", hint: "Batts, per sq ft" },
  { key: "intumescent", label: "Intumescent", hint: "Thermal & ignition barriers" },
  { key: "coatings", label: "Coatings", hint: "Roof coatings & sealants" },
] as const;
export type LineKey = (typeof PRODUCT_LINES)[number]["key"];

type P = { sku: string; category_id: string | null };
/** Which product lines an item belongs to (ISO goes with every foam). */
export function linesOf(p: P): LineKey[] {
  const s = p.sku.toUpperCase();
  if (p.category_id === "ambit-foam") {
    if (s.startsWith("ISO")) return ["insulation", "roofing", "lifting"];
    if (s.startsWith("AMB-SEAL") || s.startsWith("AMB-TITE")) return ["insulation"];
    if (s.startsWith("AMB-ROOF")) return ["roofing"];
    if (s.startsWith("AMB-JACK")) return ["lifting"];
    return ["insulation"];
  }
  if (p.category_id === "batts") return ["fiberglass"];
  if (p.category_id === "intumescent") return ["intumescent"];
  if (p.category_id === "roof") return ["coatings"];
  return [];
}
export const PRF_CATEGORIES = ["ambit-foam", "batts", "intumescent", "roof"];

export const TERMS = ["Due on receipt", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"];
export const CREDIT_RANGES = ["None (COD / prepay)", "Under $10,000", "$10,000 – $25,000", "$25,000 – $50,000", "$50,000 – $100,000", "$100,000 – $250,000", "$250,000+"];
export const CUSTOMER_TYPES = ["Contractor", "Distributor", "Both"];

export type PrfCustomer = {
  legal_name: string; contact_first: string; contact_last: string; email: string; phone: string; street: string; city: string; state: string; zip: string;
  customer_type: string; rigs: string; monthly_sets: string; current_mfr: string; billing_terms: string; credit_range: string; wants_credit: string; tax_ack: string; freight_included: string;
};
export const EMPTY_CUSTOMER: PrfCustomer = { legal_name: "", contact_first: "", contact_last: "", email: "", phone: "", street: "", city: "", state: "", zip: "",
  customer_type: "", rigs: "", monthly_sets: "", current_mfr: "", billing_terms: "", credit_range: "", wants_credit: "", tax_ack: "", freight_included: "" };
