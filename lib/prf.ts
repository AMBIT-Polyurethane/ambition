// The smart Price Request: product lines, which items each line quotes, and how each is priced.

export const PRODUCT_LINES = [
  { key: "foam", label: "AMBIT Foam Products", hint: "AMBI-SEAL, AMBI-TITE, AMBI-ROOF, AMBI-JACK · price per lb" },
  { key: "fiberglass", label: "Fiberglass", hint: "R-11 to R-38, kraft or unfaced · per sq ft · Blow In per bag" },
  { key: "intumescent", label: "Intumescents", hint: "Thermal & ignition barriers" },
  { key: "coatings", label: "Coatings", hint: "Roof coatings & sealants" },
] as const;
export type LineKey = (typeof PRODUCT_LINES)[number]["key"];

/** Requests from before 0076 used these product lines. */
export const OLD_LINE_LABELS: Record<string, string> = {
  insulation: "Insulation Foam",
  roofing: "Roofing Foam",
  lifting: "Lifting Foam",
  fiberglass: "Fiberglass",
  intumescent: "Intumescent",
  coatings: "Coatings",
  foam: "AMBIT Foam Products",
};

// Category ids: the live app's, and the older ones the test data still uses.
export const FIBERGLASS_CATS = ["fiberglass", "batts"];
export const INTUMESCENT_CATS = ["intumescent-coatings", "intumescent"];
export const COATING_CATS = ["roof-coatings-and-sealants", "roof"];
export const PRF_CATEGORIES = ["ambit-foam", ...FIBERGLASS_CATS, ...INTUMESCENT_CATS, ...COATING_CATS];

type P = { sku: string; name?: string; category_id: string | null };
/** The product lines quoted item by item (foam and fiberglass are quoted by type instead, below). */
export function linesOf(p: P): LineKey[] {
  if (INTUMESCENT_CATS.includes(p.category_id ?? "")) return ["intumescent"];
  if (COATING_CATS.includes(p.category_id ?? "")) return ["coatings"];
  return [];
}

/**
 * Foam and fiberglass are quoted by type, not item by item: the rep asks for one price per type. Once it's approved,
 * the price goes on every product of that type for the customer (per lb, per sq ft, or per bag for blow-in).
 */
export type QuoteType = { key: string; line: LineKey; label: string; basis: "lb" | "sqft" | "unit"; unit: string; match: (p: P) => boolean };

const FOAM_SKUS: Record<string, string[]> = {
  "AMBI-SEAL": ["AMB-SEAL-50", "AMB-SEAL-50-W"],
  "AMBI-TITE": ["AMB-TITE-20", "AMB-TITE-20-W"],
  "AMBI-ROOF": ["AMB-ROOF-28"],
  "AMBI-JACK": ["AMB-JACK"],
};
const foam = (key: string, label: string): QuoteType => ({
  key: `foam:${key}`,
  line: "foam",
  label,
  basis: "lb",
  unit: "lb",
  match: (p) => FOAM_SKUS[key].includes(p.sku.toUpperCase()),
});
/** "R11K 15"x93"…", "R38U 16" x 48" - JM (unfaced)": R-value and K (kraft faced) or U (unfaced). */
const BATT = /^R-?\s*(\d{2})\s*([KU])(?![A-Z])/i;
export const BLOWN = /jet ?stream|climate ?pro|blow|loose ?fill|\bl77\b|propink|insul ?safe/i;
const batt = (r: number, face: "K" | "U"): QuoteType => ({
  key: `fg:R${r}${face}`,
  line: "fiberglass",
  label: `R-${r} ${face === "K" ? "KFT (kraft faced)" : "UNF (unfaced)"}`,
  basis: "sqft",
  unit: "sq ft",
  match: (p) => {
    if (!FIBERGLASS_CATS.includes(p.category_id ?? "")) return false;
    const m = BATT.exec((p.name ?? "").trim());
    return !!m && Number(m[1]) === r && m[2].toUpperCase() === face;
  },
});
export const QUOTE_TYPES: QuoteType[] = [
  foam("AMBI-SEAL", "AMBI-SEAL 5.0 Open Cell"),
  foam("AMBI-TITE", "AMBI-TITE 204 HFO Closed Cell"),
  foam("AMBI-ROOF", "AMBI-ROOF 2.8"),
  foam("AMBI-JACK", "AMBI-JACK 4.0"),
  ...[11, 13, 15, 19, 30, 38].flatMap((r) => [batt(r, "K"), batt(r, "U")]),
  {
    key: "fg:BLOWIN",
    line: "fiberglass",
    label: "Blow In",
    basis: "unit",
    unit: "bag",
    match: (p) => FIBERGLASS_CATS.includes(p.category_id ?? "") && BLOWN.test(p.name ?? ""),
  },
];

export const CUSTOMER_TYPES = ["Contractor", "Distributor", "Both"];

export type PrfCustomer = {
  legal_name: string; contact_first: string; contact_last: string; email: string; phone: string; street: string; city: string; state: string; zip: string;
  customer_type: string; rigs: string; monthly_sets: string; current_mfr: string; tax_ack: string;
  /** New customers: "Yes, they want terms" or "No, COD / prepay", and the credit line they'll ask for. */
  wants_credit: string; credit_requested: string;
};
export const EMPTY_CUSTOMER: PrfCustomer = { legal_name: "", contact_first: "", contact_last: "", email: "", phone: "", street: "", city: "", state: "", zip: "",
  customer_type: "", rigs: "", monthly_sets: "", current_mfr: "", tax_ack: "", wants_credit: "", credit_requested: "" };
