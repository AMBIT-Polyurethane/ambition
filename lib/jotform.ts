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

export async function api<T>(path: string, revalidate: number | false): Promise<T> {
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

/** Changes answers on a submission. Needs a Jotform key with Full Access (a read-only key is refused). */
export async function updateSubmission(id: string, values: Record<string, string>): Promise<void> {
  const key = process.env.JOTFORM_API_KEY?.trim();
  if (!key) throw new JotformError("The Jotform key isn't set up yet.");
  if (!/^\d{6,25}$/.test(id)) throw new JotformError("That price request doesn't exist.");
  const body = new URLSearchParams();
  for (const [qid, v] of Object.entries(values)) if (/^\d+$/.test(qid)) body.set(`submission[${qid}]`, v);
  let res: Response;
  try {
    res = await fetch(`${JOTFORM_API_URL}/submission/${id}`, {
      method: "POST",
      headers: { APIKEY: key, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new JotformError("Jotform didn't answer. Try again in a minute.");
  }
  const json = (await res.json().catch(() => null)) as { responseCode?: number; message?: string } | null;
  if (res.status === 401 || res.status === 403 || json?.responseCode === 401 || json?.responseCode === 403) {
    throw new JotformError(
      "Jotform refused the change: the app's Jotform key can only read. Make a Full Access key in Jotform (Settings → API) and put it in Vercel as JOTFORM_API_KEY.",
    );
  }
  if (!res.ok || !json || (json.responseCode && json.responseCode !== 200)) throw new JotformError(`Jotform said: ${json?.message || res.status}`);
}

// ------------------------------------------------------------------ fields
export type PrfFields = { rep?: string; customer?: string; contact?: string; date?: string; repEmail?: string };

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
    repEmail: find(qs, (q) => /sales\s*person\s*email/i.test(label(q)), (q) => /rep.*email/i.test(label(q))),
  };
}

// ------------------------------------------------------------------ pricing
/** One product on the form: the rep's requested price box and the manager's approved price box. */
export type PricePair = { product: string; section: string; reqQid: string; apprQid: string | null };

const strip = (t: string) => t.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const priceKey = (t: string) => strip(t).replace(/\(approved price\)/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Reads the form's layout: textboxes under "Price Request Section" are what the rep asks for; the
 * "(Approved Price)" boxes under "Approved Prices (Manager Use Only)" are the answers. Matched by product name.
 */
export async function prfPricing(): Promise<PricePair[]> {
  const content = await api<Record<string, Question>>(`/form/${PRF_FORM_ID}/questions`, 3600);
  const qs = Object.values(content).sort((a, b) => Number(a.order) - Number(b.order));
  const requested: { key: string; product: string; section: string; qid: string }[] = [];
  const approved: { key: string; section: string; qid: string }[] = [];
  let zone: "before" | "request" | "approved" = "before";
  let section = "";
  for (const q of qs) {
    const label = strip(q.text ?? "");
    if (q.type === "control_head") {
      if (/approved prices/i.test(label)) zone = "approved";
      else if (/price request section/i.test(label)) zone = "request";
      else if (zone !== "before") section = label;
      continue;
    }
    if (!/^control_(textbox|number|spinner)$/.test(q.type)) continue;
    if (zone === "approved" || /\(approved price\)/i.test(label)) approved.push({ key: priceKey(label), section, qid: q.qid });
    else if (zone === "request") requested.push({ key: priceKey(label), product: label, section, qid: q.qid });
  }
  const used = new Set<string>();
  return requested.map((r, i) => {
    const hit = approved.find((a) => !used.has(a.qid) && a.key === r.key) ?? (approved[i] && !used.has(approved[i].qid) && approved.length === requested.length ? approved[i] : undefined);
    if (hit) used.add(hit.qid);
    return { product: r.product, section: r.section, reqQid: r.qid, apprQid: hit?.qid ?? null };
  });
}

export type PriceRow = PricePair & { requested: string; approved: string };

export const priceRows = (s: Submission, pairs: PricePair[]): PriceRow[] =>
  pairs.map((p) => ({ ...p, requested: answerText(s.answers[p.reqQid]), approved: p.apprQid ? answerText(s.answers[p.apprQid]) : "" }));

export type PrfStatus = "pending" | "approved" | "no_prices";

/** Approved when a manager filled any approved price (here or in Jotform); pending when prices were asked for. */
export function prfStatus(s: Submission, pairs: PricePair[], reviewed: boolean): PrfStatus {
  const rows = priceRows(s, pairs);
  if (reviewed || rows.some((r) => r.approved)) return "approved";
  return rows.some((r) => r.requested) ? "pending" : "no_prices";
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
export const decode = (s: string) =>
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

export const LAYOUT = new Set(["control_text", "control_button", "control_pagebreak", "control_divider", "control_image", "control_collapse", "control_captcha", "control_clear", "control_widget_empty"]);

/** Labeled answers in form order; section headings come through as { heading }. */
export function answerRows(s: Submission, skip?: Set<string>): ({ heading: string } | { label: string; value: string })[] {
  const rows: ({ heading: string } | { label: string; value: string })[] = [];
  const items = Object.entries(s.answers ?? {})
    .filter(([qid]) => !skip?.has(qid))
    .map(([, a]) => a)
    .sort((a, b) => Number(a.order) - Number(b.order));
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
  status?: PrfStatus;
  priced?: number; // products with a requested price
};

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s.trim());

/**
 * Who owns each request. The SALES REP box may hold an email (matched to the app account's email)
 * or a name (matched to the account's full name). An admin's manual link always wins.
 */
export function toItems(
  subs: Submission[],
  f: PrfFields,
  links: RepLink[],
  staff: { id: string; full_name: string | null; email?: string | null }[],
  pricing?: { pairs: PricePair[]; reviewed: Set<string> },
): PrfItem[] {
  const byName = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const p of staff) {
    const k = normName(p.full_name);
    if (k && !byName.has(k)) byName.set(k, p.id);
    if (p.email) byEmail.set(p.email.trim().toLowerCase(), p.id);
  }
  const linked = new Map(links.map((l) => [normName(l.rep_name), l.profile_id]));
  return subs.map((s) => {
    const rep = f.rep ? answerText(s.answers[f.rep]) : "";
    const repKey = normName(rep);
    const owner = !repKey
      ? null
      : linked.get(repKey) ?? (looksLikeEmail(rep) ? byEmail.get(rep.trim().toLowerCase()) : undefined) ?? byName.get(repKey) ?? null;
    return {
      id: s.id,
      created_at: s.created_at,
      updated_at: s.updated_at,
      rep,
      repKey,
      customer: f.customer ? answerText(s.answers[f.customer]) : "",
      contact: f.contact ? answerText(s.answers[f.contact]) : "",
      date: f.date ? answerText(s.answers[f.date]) : "",
      ownerId: owner,
      ...(pricing
        ? {
            status: prfStatus(s, pricing.pairs, pricing.reviewed.has(s.id)),
            priced: priceRows(s, pricing.pairs).filter((r) => r.requested).length,
          }
        : {}),
    };
  });
}
