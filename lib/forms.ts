import "server-only";
import { jfDate } from "@/lib/format";
import { JOTFORM_API_URL, JOTFORM_SITE, JotformError, LAYOUT, PRF_FORM_ID, answerText, api, decode, type Answer, type Submission } from "@/lib/jotform";

// The admin forms hub: every form in AMBIT's Jotform account, found automatically.
// Credit applications and customer account setup forms get an approval step (credit limit, terms, note);
// every other form can be read and downloaded as a PDF.

export type FormKind = "credit" | "account" | "prf" | "other";

export type HubForm = {
  id: string;
  title: string;
  kind: FormKind;
  count: number;
  lastSubmission: string | null;
  enabled: boolean;
  url: string;
};

type RawForm = { id: string; title: string; status: string; count?: string | number; last_submission?: string | null; url?: string; archived?: string | number };

/** Which forms need an approval, read from the form's title. */
export function formKind(id: string, title: string): FormKind {
  if (id === PRF_FORM_ID) return "prf";
  const t = title.toLowerCase();
  if (/credit/.test(t)) return "credit";
  if (/account\s*set\s*-?\s*up|new\s+(customer|account)|(customer|account)\s+(application|information|info|opening|open|form)|open(ing)?\s+an?\s+account/.test(t)) return "account";
  return "other";
}

export const reviewable = (k: FormKind) => k === "credit" || k === "account";

export const KIND_LABEL: Record<FormKind, string> = {
  credit: "Credit application",
  account: "Customer account setup",
  prf: "Price request",
  other: "Form",
};

const ORDER: Record<FormKind, number> = { credit: 0, account: 1, prf: 2, other: 3 };

/** Every form in the Jotform account that isn't deleted. Credit and account forms first. */
export async function hubForms(): Promise<HubForm[]> {
  const filter = encodeURIComponent(JSON.stringify({ "status:ne": "DELETED" }));
  const raw = await api<RawForm[]>(`/user/forms?limit=500&filter=${filter}`, 120);
  return (raw ?? [])
    .filter((f) => f && f.id && f.status !== "DELETED")
    .map((f) => {
      const title = decode(String(f.title ?? "")) || "Untitled form";
      return {
        id: String(f.id),
        title,
        kind: formKind(String(f.id), title),
        count: Number(f.count ?? 0) || 0,
        lastSubmission: f.last_submission ?? null,
        enabled: f.status === "ENABLED",
        url: f.url || `${JOTFORM_SITE}/${f.id}`,
      };
    })
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || Number(b.enabled) - Number(a.enabled) || a.title.localeCompare(b.title));
}

export async function hubForm(id: string): Promise<HubForm | null> {
  if (!/^\d{6,25}$/.test(id)) return null;
  const all = await hubForms();
  return all.find((f) => f.id === id) ?? null;
}

/** Every live (not deleted) submission of a form, newest first. */
export async function formSubmissions(formId: string, revalidate: number | false = false): Promise<Submission[]> {
  if (!/^\d{6,25}$/.test(formId)) return [];
  const all: Submission[] = [];
  const filter = encodeURIComponent(JSON.stringify({ "status:ne": "DELETED" }));
  for (let offset = 0; offset < 10000; offset += 1000) {
    const page = await api<Submission[]>(`/form/${formId}/submissions?limit=1000&offset=${offset}&orderby=created_at&filter=${filter}`, revalidate);
    all.push(...(page ?? []).filter((s) => s.status !== "DELETED"));
    if (!page || page.length < 1000) break;
  }
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function formSubmission(formId: string, id: string): Promise<Submission | null> {
  if (!/^\d{6,25}$/.test(id)) return null;
  try {
    const s = await api<Submission>(`/submission/${id}`, false);
    if (!s || String(s.form_id) !== formId || s.status === "DELETED") return null;
    return s;
  } catch (e) {
    if (e instanceof JotformError && /404|not found/i.test(e.message)) return null;
    throw e;
  }
}

// ------------------------------------------------------------------ reading answers
export type Field = {
  qid: string;
  label: string;
  value: string;
  type: string;
  /** Long answers and addresses take the full width on the page and the PDF. */
  wide: boolean;
  /** Uploaded files (W-9, tax exemption certificate ...). */
  files?: { name: string; url: string }[];
  /** Signature image address. */
  signature?: string;
};
export type Section = { heading: string; fields: Field[] };

const label = (a: Answer) => decode(a.text ?? a.name ?? "").replace(/[*:]+\s*$/, "").trim();

const URL_RE = /https?:\/\/[^\s"'<>,]+/g;

function filesOf(a: Answer): { name: string; url: string }[] {
  const urls = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string") (v.match(URL_RE) ?? []).forEach((u) => urls.add(u));
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(add);
  };
  add(a.answer);
  if (!urls.size && typeof a.prettyFormat === "string") add(a.prettyFormat);
  return [...urls].map((url) => ({ url, name: decodeURIComponent(url.split("/").pop() ?? "file").replace(/\?.*$/, "") }));
}

/** Addresses as mailing lines, dates as "Oct 20, 2026", money boxes as dollars. */
function tidy(a: Answer, l: string, text: string): string {
  let addr: Record<string, string> | null =
    a.type === "control_address" && a.answer && typeof a.answer === "object" && !Array.isArray(a.answer) ? (a.answer as Record<string, string>) : null;
  if (!addr && a.type === "control_address" && /Street Address:|City:/i.test(text)) {
    // Jotform's printable version: "Street Address: 22 Main St\nCity: Enid\nState / Province: OK\nPostal / Zip Code: 73701"
    const pick = (re: RegExp) => (text.match(re)?.[1] ?? "").trim();
    addr = {
      addr_line1: pick(/Street Address:\s*(.*)/i),
      addr_line2: pick(/Street Address Line 2:\s*(.*)/i),
      city: pick(/City:\s*(.*)/i),
      state: pick(/State(?: \/ Province)?:\s*(.*)/i),
      postal: pick(/(?:Postal \/ )?Zip Code:\s*(.*)/i),
      country: pick(/Country:\s*(.*)/i),
    };
  }
  if (addr) {
    const o = addr;
    const street = [o.addr_line1, o.addr_line2].map((x) => (x ?? "").trim()).filter(Boolean).join(", ");
    const cityLine = [(o.city ?? "").trim(), [(o.state ?? "").trim(), (o.postal ?? "").trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const country = (o.country ?? "").trim();
    const lines = [street, cityLine, country && !/^(us|usa|united states)$/i.test(country) ? country : ""].filter(Boolean);
    if (lines.length) return lines.join("\n");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return jfDate(text);
  if (/limit|amount|\$|dollar|budget|purchases? per month \(\$/i.test(l) && /^\d+(\.\d+)?$/.test(text.replace(/,/g, ""))) {
    return Number(text.replace(/,/g, "")).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  }
  return text;
}

/** A submission's answers in form order, grouped under the form's section headings. */
export function formSections(s: Submission, skip?: Set<string>): Section[] {
  const items = Object.entries(s.answers ?? {})
    .filter(([qid]) => !skip?.has(qid))
    .map(([qid, a]) => ({ qid, a }))
    .sort((x, y) => Number(x.a.order) - Number(y.a.order));
  const sections: Section[] = [{ heading: "", fields: [] }];
  let firstHead = true;
  for (const { qid, a } of items) {
    if (a.type === "control_head") {
      if (firstHead && sections.length === 1 && sections[0].fields.length === 0) {
        firstHead = false; // the form's own title
        continue;
      }
      sections.push({ heading: decode(a.text ?? ""), fields: [] });
      continue;
    }
    if (!a.type || LAYOUT.has(a.type)) continue;
    const l = label(a);
    if (a.type === "control_signature") {
      const url = typeof a.answer === "string" ? (a.answer.match(URL_RE) ?? [])[0] : undefined;
      if (url) sections[sections.length - 1].fields.push({ qid, label: l || "Signature", value: "Signed", type: a.type, wide: true, signature: url });
      continue;
    }
    if (a.type === "control_fileupload") {
      const files = filesOf(a);
      if (files.length) sections[sections.length - 1].fields.push({ qid, label: l, value: files.map((f) => f.name).join(", "), type: a.type, wide: true, files });
      continue;
    }
    const value = tidy(a, l, answerText(a));
    if (!value) continue;
    const wide = value.length > 60 || value.includes("\n") || /textarea|address|matrix|widget/.test(a.type);
    sections[sections.length - 1].fields.push({ qid, label: l, value, type: a.type, wide });
  }
  return sections.filter((x) => x.fields.length > 0);
}

/** A short title and subtitle for lists: the business name first, then contact details. */
export function summarize(s: Submission): { title: string; sub: string } {
  const fields = formSections(s).flatMap((x) => x.fields);
  const by = (...tests: RegExp[]) => {
    for (const t of tests) {
      const f = fields.find((x) => t.test(x.label) && x.value && !x.files && !x.signature);
      if (f) return f.value.split("\n")[0].trim();
    }
    return "";
  };
  const business = by(/legal\s+(business\s+)?name/i, /(business|company|firm)\s*name/i, /name\s+of\s+(the\s+)?(business|company)/i, /\bd\s*\/?\s*b\s*\/?\s*a\b/i, /^company$/i);
  const person =
    fields.find((x) => x.type === "control_fullname")?.value ||
    by(/(contact|applicant|owner|customer)\s*(name)?/i, /^(full\s+)?name$/i);
  const email = fields.find((x) => x.type === "control_email")?.value ?? "";
  const phone = fields.find((x) => x.type === "control_phone")?.value ?? "";
  const title = business || person || email || `Submission ${s.id.slice(-6)}`;
  const sub = [business ? person : "", email, phone].filter(Boolean).join(" · ");
  return { title, sub };
}

// ------------------------------------------------------------------ files
/** Only Jotform's own upload addresses can be fetched through the app. */
export function isJotformFile(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)jotform\.com$/i.test(url.hostname) && /\/uploads\//.test(url.pathname);
  } catch {
    return false;
  }
}

/** Downloads an uploaded file or signature from Jotform with the app's key (uploads need a login to view). */
export async function fetchJotformFile(u: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const key = process.env.JOTFORM_API_KEY?.trim();
  if (!key || !isJotformFile(u)) return null;
  const tries = [
    () => fetch(u, { headers: { APIKEY: key }, cache: "no-store", signal: AbortSignal.timeout(15_000) }),
    () => fetch(`${u}${u.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }),
  ];
  for (const t of tries) {
    try {
      const res = await t();
      const type = res.headers.get("content-type") ?? "application/octet-stream";
      if (res.ok && !/text\/html/i.test(type)) return { body: await res.arrayBuffer(), type };
    } catch {
      /* try the next way */
    }
  }
  return null;
}

export const jotformEditUrl = (id: string) => `${JOTFORM_SITE}/edit/${id}`;
export const jotformInboxUrl = (formId: string) => `${JOTFORM_API_URL.replace(/\/API$/i, "")}/inbox/${formId}`;
