// Ask AMBIT: shared settings, used by the server and the screens.

export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Recommended: careful technical answers, fast", inPerM: 2, outPerM: 10 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest and cheapest, weaker on hard questions", inPerM: 0.1, outPerM: 0.5 },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Most thorough, about twice Sonnet's cost", inPerM: 4, outPerM: 20 },
] as const;
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const modelInfo = (id: string | null | undefined) => MODELS.find((m) => m.id === id) ?? MODELS[0];

/** What each kind of knowledge is, and what it's allowed to be used for. */
export const KINDS = [
  { id: "teaching", label: "AMBIT teaching (TSBs, Jeremiah)", short: "AMBIT teaching", hint: "Building science: the only source for how assemblies, moisture, air and foam behave" },
  { id: "product", label: "AMBIT product docs", short: "AMBIT product", hint: "TDS, SDS, ESR / CCRR, application guides, warranties" },
  { id: "code", label: "Building code (IECC / IRC / IBC)", short: "Code", hint: "Only the ICC codes: IECC, IRC, IBC" },
  { id: "hvac", label: "HVAC design (ACCA / ASHRAE)", short: "HVAC", hint: "ACCA manuals, ASHRAE, other neutral parties" },
  { id: "science", label: "Neutral science", short: "Science", hint: "Physics and research not tied to spray foam or HVAC industry groups" },
  { id: "app", label: "Using the app", short: "App help", hint: "How to do things in AMBIT Intelligence" },
] as const;
export type Kind = (typeof KINDS)[number]["id"];
export const kindInfo = (id: string | null | undefined) => KINDS.find((k) => k.id === id) ?? KINDS[KINDS.length - 1];

/** Which Docs-library types the assistant may learn from, and as what. The SPFA library never. */
export const DOC_KIND: Record<string, Kind | null> = {
  TSB: "teaching",
  TDS: "product",
  SDS: "product",
  ESR: "product",
  CCRR: "product",
  Guide: "product",
  Warranty: "product",
  Certificate: "product",
  Training: "teaching",
  Marketing: null,
  Industry: null, // SPFA library: never
  Other: null,
};

export const DEFAULT_SITES = [
  "codes.iccsafe.org",
  "energycodes.gov",
  "acca.org",
  "ashrae.org",
  "energy.gov",
  "ornl.gov",
  "nrel.gov",
  "pnnl.gov",
  "nist.gov",
  "lbl.gov",
  "osti.gov",
];

/** Sites that can never be added to the approved list, whatever is typed. */
export const NEVER_SITES = [
  "spfa.org",
  "sprayfoam.com",
  "sprayfoamworld.com",
  "sprayfoammagazine.com",
  "polyurethane.americanchemistry.com",
  "americanchemistry.com",
  "sprayfoamcoalition.org",
];

export function cleanSite(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  if (!t || !/^[a-z0-9.-]+\.[a-z]{2,}(\/[a-z0-9._~\-/]*)?$/.test(t)) return null;
  const host = t.split("/")[0];
  if (NEVER_SITES.some((n) => host === n || host.endsWith("." + n))) return null;
  return t;
}

export type AiSettings = {
  model: string;
  open_to_customers: boolean;
  web_lookups: boolean;
  allowed_sites: string[];
  daily_limit_staff: number;
  daily_limit_customer: number;
  teachers: string[];
  extra_rules: string | null;
  updated_at?: string;
  updated_by_name?: string | null;
};

export const DEFAULT_SETTINGS: AiSettings = {
  model: DEFAULT_MODEL,
  open_to_customers: false,
  web_lookups: true,
  allowed_sites: DEFAULT_SITES,
  daily_limit_staff: 150,
  daily_limit_customer: 40,
  teachers: [],
  extra_rules: null,
};

/** One numbered source under an answer. */
export type AiSource = {
  n: number;
  title: string;
  kind: string; // a KINDS id, or "web"
  href: string;
  page?: number | null;
  site?: string | null;
  quote?: string | null;
};

/** A piece of an answer and the sources it leans on. */
export type AiPart = { text: string; cites: number[] };

export const NO_SOURCE_MARK = "[[NO_SOURCE]]";
export const COMPLAINT_MARK = "[[COMPLAINT]]";

/** Splits text (a PDF page, a note) into search-sized pieces at paragraph or sentence breaks. */
export function chunkText(text: string, size = 1100): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const out: string[] = [];
  let rest = clean;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    if (cut < size * 0.5) cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    if (cut < size * 0.5) cut = window.lastIndexOf(" ");
    if (cut < size * 0.3) cut = size;
    out.push(rest.slice(0, cut + 1).trim());
    // A little overlap so a sentence split across pieces is still found.
    const back = rest.slice(Math.max(0, cut - 120), cut + 1);
    const overlapStart = back.lastIndexOf(". ");
    rest = (overlapStart >= 0 ? back.slice(overlapStart + 2) : "") + rest.slice(cut + 1);
    rest = rest.trim();
  }
  if (rest) out.push(rest);
  return out.filter((c) => c.length > 20);
}

export type ChunkRow = { page: number | null; seq: number; title: string; body: string };

/** Pages of text -> numbered chunks ready for ai_replace_chunks. */
export function chunkPages(title: string, pages: { page: number | null; text: string }[]): ChunkRow[] {
  const rows: ChunkRow[] = [];
  let seq = 0;
  for (const p of pages) for (const body of chunkText(p.text)) rows.push({ page: p.page, seq: seq++, title, body });
  return rows;
}
