import type { DocumentRow } from "@/lib/types";

// Every document type the library knows, in the order they're listed on a product.
export const DOC_TYPES: { id: string; label: string; short: string; icon: string }[] = [
  { id: "TDS", label: "Technical data sheet", short: "TDS", icon: "docs" },
  { id: "SDS", label: "Safety data sheet", short: "SDS", icon: "shield" },
  { id: "ESR", label: "ICC-ES evaluation report", short: "ESR", icon: "award" },
  { id: "CCRR", label: "Code compliance report", short: "CCRR", icon: "award" },
  { id: "Guide", label: "Application guide", short: "Guide", icon: "book" },
  { id: "Warranty", label: "Warranty", short: "Warranty", icon: "clipboard" },
  { id: "Certificate", label: "Certificate", short: "Cert", icon: "clipboard" },
  { id: "Marketing", label: "Brochure / marketing", short: "Brochure", icon: "megaphone" },
  { id: "Training", label: "Training", short: "Training", icon: "academy" },
  { id: "TSB", label: "Technical service bulletin", short: "TSB", icon: "bulletin" },
  { id: "Industry", label: "Industry guidance (SPFA)", short: "SPFA", icon: "book" },
  { id: "Other", label: "Other", short: "Doc", icon: "docs" },
];

export const TYPE_ORDER = Object.fromEntries(DOC_TYPES.map((t, i) => [t.id, i]));
export const typeInfo = (id: string) => DOC_TYPES.find((t) => t.id === id) ?? DOC_TYPES[DOC_TYPES.length - 1];

// Filter chips on the Docs tab.
export const DOC_GROUPS: { id: string; label: string; types: string[] }[] = [
  { id: "all", label: "All", types: [] },
  { id: "tds", label: "Data sheets", types: ["TDS"] },
  { id: "sds", label: "Safety (SDS)", types: ["SDS"] },
  { id: "code", label: "Code reports", types: ["ESR", "CCRR"] },
  { id: "guides", label: "Guides & warranties", types: ["Guide", "Warranty", "Certificate", "Training"] },
  { id: "marketing", label: "Brochures", types: ["Marketing"] },
  { id: "spfa", label: "SPFA library", types: ["Industry"] },
  { id: "tsb", label: "Bulletins", types: ["TSB"] },
];

// Shelves for the SPFA library, in display order.
export const LIBRARY_SHELVES = ["Insulation", "Roofing", "General", "Specialty"];

export function docProducts(d: Pick<DocumentRow, "products" | "product">): string[] {
  if (Array.isArray(d.products) && d.products.length) return d.products;
  return d.product ? [d.product] : [];
}

/** Product families in the order they first appear (docs are sorted by "sort"). */
export function productFamilies(docs: DocumentRow[]): string[] {
  const seen: string[] = [];
  for (const d of docs) for (const p of docProducts(d)) if (!seen.includes(p)) seen.push(p);
  return seen;
}

export function parseProducts(text: string): string[] {
  return Array.from(new Set(text.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)));
}

export type RenewalState = { state: "none" | "ok" | "soon" | "past"; label: string };

/** Code reports carry a renewal date; staff see a warning once it is close or has passed. */
export function renewalState(renewalOn: string | null | undefined, today = new Date()): RenewalState {
  if (!renewalOn) return { state: "none", label: "" };
  const due = new Date(`${renewalOn}T12:00:00`);
  if (Number.isNaN(due.getTime())) return { state: "none", label: "" };
  const nice = due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const days = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { state: "past", label: `Renewal date passed ${nice}` };
  if (days <= 60) return { state: "soon", label: `Renews ${nice}` };
  return { state: "ok", label: `Renews ${nice}` };
}

export const hasFile = (d: Pick<DocumentRow, "url" | "storage_path">) => Boolean(d.storage_path || d.url);

/** Short storage key for a copied file, e.g. "tds/ambi-seal-5-0-technical-data-sheet-3f2a.pdf". */
export function storageKeyFor(d: Pick<DocumentRow, "id" | "title" | "doc_type" | "audience">, ext = "pdf"): string {
  const base = d.title.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
  const folder = d.doc_type.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${d.audience === "employee" ? "internal/" : ""}${folder}/${base}-${d.id.slice(0, 4)}.${ext}`;
}

/** File extension and content type the docs bucket accepts, from a response's type or the link. */
export function fileKind(contentType: string | null, url: string): { ext: string; type: string } | null {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const path = url.split(/[?#]/)[0].toLowerCase();
  const KINDS: [string, string][] = [
    ["pdf", "application/pdf"],
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ];
  const byType = KINDS.find(([, t]) => t === ct);
  if (byType) return { ext: byType[0] === "jpeg" ? "jpg" : byType[0], type: byType[1] };
  const byExt = KINDS.find(([e]) => path.endsWith(`.${e}`));
  if (byExt && (!ct || ct === "application/octet-stream" || ct === "binary/octet-stream")) return { ext: byExt[0], type: byExt[1] };
  return null;
}
