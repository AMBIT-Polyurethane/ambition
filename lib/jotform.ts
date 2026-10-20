import "server-only";

// Reads Price Request Form (PRF) submissions from Jotform. The API key never leaves the server.
// Vercel settings: JOTFORM_API_KEY (required), JOTFORM_API_URL and PRF_FORM_ID (optional).

export const JOTFORM_API_URL = (process.env.JOTFORM_API_URL || "https://ambit-polyurethane.jotform.com/API").replace(/\/+$/, "");
export const JOTFORM_SITE = JOTFORM_API_URL.replace(/\/API$/i, "");
export const PRF_FORM_ID = (process.env.PRF_FORM_ID || "252896183848172").trim();

export const jotformReady = () => Boolean(process.env.JOTFORM_API_KEY?.trim());

export class JotformError extends Error {}

type Question = { qid: string; name?: string; text?: string; type: string; order: string };
export type Answer = { name?: string; order?: string; text?: string; type?: string; answer?: unknown; prettyFormat?: string };
export type Submission = {
  id: string;
  form_id: string;
  created_at: string;
  updated_at: string | null;
  status: string;
  answers: Record<string, Answer>;
};

async function api<T>(path: string, revalidate: number | false): Promise<T> {
  const key = process.env.JOTFORM_API_KEY?.trim();
  if (!key) throw new JotformError("The Jotform key isn't set up yet.");
  let res: Response;
  try {
    res = await fetch(`${JOTFORM_API_URL}${path}`, {
      headers: { APIKEY: key, Accept: "application/json" },
      ...(revalidate === false ? { cache: "no-store" as const } : { next: { revalidate } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new JotformError("Jotform didn't answer. Try again in a minute.");
  }
  const body = (await res.json().catch(() => null)) as { responseCode?: number; message?: string; content?: T } | null;
  if (res.status === 401 || body?.responseCode === 401) throw new JotformError("Jotform didn't accept the app's key. It may have been deleted or mistyped.");
  if (!res.ok || !body || (body.responseCode && body.responseCode !== 200)) {
    throw new JotformError(`Jotform said: ${body?.message || res.status}`);
  }
  return body.content as T;
}

// ------------------------------------------------------------------ fields
export type PrfFields = { rep?: string; customer?: string; contact?: string; date?: string };

const find = (qs: Question[], ...tests: ((q: Question) => boolean)[]) => {
  for (const t of tests) {
    const q = qs.find(t);
    if (q) return q.qid;
  }
  return undefined;
};

export async function prfFields(): Promise<PrfFields> {
  const content = await api<Record<string, Question>>(`/form/${PRF_FORM_ID}/questions`, 3600);
  const qs = Object.values(content).sort((a, b) => Number(a.order) - Number(b.order));
  const label = (q: Question) => (q.text ?? "").replace(/<[^>]*>/g, " ").trim();
  return {
    rep: find(qs, (q) => /sales\s*rep/i.test(label(q)), (q) => /\brep(resentative)?\b/i.test(label(q))),
    customer: find(qs, (q) => /legal business name/i.test(label(q)), (q) => /(business|company) name/i.test(label(q))),
    contact: find(qs, (q) => /customer name/i.test(label(q)), (q) => q.type === "control_fullname"),
    date: find(qs, (q) => q.type === "control_datetime" && /^date\b/i.test(label(q)), (q) => q.type === "control_datetime"),
  };
}

/** Every live (not deleted) PRF submission, newest first. */
export async function prfSubmissions(): Promise<Submission[]> {
  const all: Submission[] = [];
  const filter = encodeURIComponent(JSON.stringify({ "status:ne": "DELETED" }));
  for (let offset = 0; offset < 5000; offset += 1000) {
    const page = await api<Submission[]>(`/form/${PRF_FORM_ID}/submissions?limit=1000&offset=${offset}&orderby=created_at&filter=${filter}`, false);
    all.push(...page.filter((s) => s.status !== "DELETED"));
    if (page.length < 1000) break;
  }
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function prfSubmission(id: string): Promise<Submission | null> {
  if (!/^\d{6,25}$/.test(id)) return null;
  try {
    const s = await api<Submission>(`/submission/${id}`, false);
    if (!s || String(s.form_id) !== PRF_FORM_ID || s.status === "DELETED") return null;
    return s;
  } catch (e) {
    if (e instanceof JotformError && /404|not found/i.test(e.message)) return null;
    throw e;
  }
}

export const editUrl = (id: string) => `${JOTFORM_SITE}/edit/${id}`;
export const formUrl = () => `${JOTFORM_SITE}/${PRF_FORM_ID}`;

// ------------------------------------------------------------------ answers
const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

function flatten(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") {
    const t = v.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return flatten(JSON.parse(t));
      } catch {
        /* plain text that looks like JSON */
      }
    }
    return decode(t);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("datetime" in o && typeof o.datetime === "string") return o.datetime.slice(0, 10);
    return Object.entries(o)
      .filter(([k]) => !/^(datetime|timeInput|hourSelect|minuteSelect|ampm)$/.test(k))
      .map(([, x]) => flatten(x))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** A Jotform answer as readable text ("" when blank). */
export function answerText(a: Answer | undefined): string {
  if (!a) return "";
  if (typeof a.prettyFormat === "string" && a.prettyFormat.trim()) return decode(a.prettyFormat);
  return flatten(a.answer);
}

const LAYOUT = new Set(["control_text", "control_button", "control_pagebreak", "control_divider", "control_image", "control_collapse", "control_captcha", "control_clear", "control_widget_empty"]);

/** Labeled answers in form order; section headings come through as { heading }. */
export function answerRows(s: Submission): ({ heading: string } | { label: string; value: string })[] {
  const rows: ({ heading: string } | { label: string; value: string })[] = [];
  const items = Object.values(s.answers ?? {}).sort((a, b) => Number(a.order) - Number(b.order));
  let firstHead = true;
  for (const a of items) {
    if (a.type === "control_head") {
      if (firstHead) {
        firstHead = false;
        continue;
      }
      rows.push({ heading: decode(a.text ?? "") });
      continue;
    }
    if (!a.type || LAYOUT.has(a.type)) continue;
    const value = answerText(a);
    if (!value) continue;
    rows.push({ label: decode(a.text ?? a.name ?? ""), value });
  }
  // drop headings with nothing under them
  return rows.filter((r, i) => !("heading" in r) || (rows[i + 1] && !("heading" in rows[i + 1])));
}

// ------------------------------------------------------------------ owners
/** "Bryant, Jeremiah" and "jeremiah  bryant" both become "jeremiah bryant". */
export function normName(s: string | null | undefined): string {
  let t = String(s ?? "").toLowerCase().replace(/[^a-z0-9, ]+/g, " ").replace(/\s+/g, " ").trim();
  const flip = /^([^,]+),\s*(.+)$/.exec(t);
  if (flip) t = `${flip[2]} ${flip[1]}`;
  return t.replace(/,/g, "").replace(/\s+/g, " ").trim();
}

export type RepLink = { rep_name: string; profile_id: string };
export type PrfItem = {
  id: string;
  created_at: string;
  updated_at: string | null;
  rep: string;
  repKey: string;
  customer: string;
  contact: string;
  date: string;
  ownerId: string | null;
};

export function toItems(subs: Submission[], f: PrfFields, links: RepLink[], staff: { id: string; full_name: string | null }[]): PrfItem[] {
  const byName = new Map<string, string>();
  for (const p of staff) {
    const k = normName(p.full_name);
    if (k && !byName.has(k)) byName.set(k, p.id);
  }
  for (const l of links) byName.set(normName(l.rep_name), l.profile_id);
  return subs.map((s) => {
    const rep = f.rep ? answerText(s.answers[f.rep]) : "";
    const repKey = normName(rep);
    return {
      id: s.id,
      created_at: s.created_at,
      updated_at: s.updated_at,
      rep,
      repKey,
      customer: f.customer ? answerText(s.answers[f.customer]) : "",
      contact: f.contact ? answerText(s.answers[f.contact]) : "",
      date: f.date ? answerText(s.answers[f.date]) : "",
      ownerId: repKey ? byName.get(repKey) ?? null : null,
    };
  });
}
