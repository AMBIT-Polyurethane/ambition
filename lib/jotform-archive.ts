import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRF_FORM_ID, decode, liveApi, type Submission } from "@/lib/jotform";
import { EXPENSE_FORM_ID } from "@/lib/expenses";
import { formKind, isJotformFile, liveJotformFile, urlsIn, type ExtraForm, type FormKind } from "@/lib/forms";
import { ARCHIVE_BUCKET } from "@/lib/jotform-store";

// Copies everything out of Jotform into A.I. (0111), in steps the Admin › Forms hub › Copy from Jotform page runs one
// after another: the forms, then each form's submissions, then their files a few at a time. Running it again only
// adds what's new (files already saved are skipped), so it's safe to run right before Jotform is cancelled.

type RawForm = { id: string; title: string; status: string; count?: string | number };
export type ArchiveForm = { id: string; title: string; kind: FormKind; count: number };
export type PendingFile = { url: string; sub: string };

const DELETED = encodeURIComponent(JSON.stringify({ "status:ne": "DELETED" }));

/** Every Jotform file address anywhere on a submission (uploads, signatures, photo widgets). */
export function fileUrls(s: Submission): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") urlsIn(v).forEach((u) => isJotformFile(u) && out.add(u.replace(/[).;]+$/, "")));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(s.answers);
  return [...out];
}

/** Step 1: every form the app can read (its own, the price request and expense receipt forms, and any added by link). */
export async function archiveForms(db: SupabaseClient, extra: ExtraForm[], who: string): Promise<ArchiveForm[]> {
  const raw = new Map<string, RawForm>();
  const owned = await liveApi<RawForm[]>(`/user/forms?limit=500&filter=${DELETED}`, false).catch(() => [] as RawForm[]);
  for (const f of owned ?? []) if (f?.id && f.status !== "DELETED") raw.set(String(f.id), f);
  const ids = [...new Set([PRF_FORM_ID, EXPENSE_FORM_ID, ...extra.map((e) => e.id)])].filter((id) => /^\d{6,25}$/.test(id) && !raw.has(id));
  await Promise.all(
    ids.map(async (id) => {
      const f = await liveApi<RawForm>(`/form/${id}`, false).catch(() => null);
      if (f?.id && f.status !== "DELETED") raw.set(String(f.id), f);
    }),
  );
  if (!raw.size) throw new Error("Jotform didn't list any forms. Check the Jotform key in Vercel.");
  const kinds = new Map(extra.filter((e) => e.kind).map((e) => [e.id, e.kind as FormKind]));
  const out: ArchiveForm[] = [];
  for (const f of raw.values()) {
    const id = String(f.id);
    const title = decode(String(f.title ?? "")) || "Untitled form";
    const questions = await liveApi<Record<string, unknown>>(`/form/${id}/questions`, false).catch(() => null);
    const kind = kinds.get(id) ?? formKind(id, title);
    const { error } = await db.from("jotform_archive_forms").upsert({ form_id: id, title, kind, raw: f, questions, live_count: Number(f.count ?? 0) || 0, archived_at: new Date().toISOString(), archived_by: who });
    if (error) throw new Error(/jotform_archive|schema cache/i.test(error.message) ? "Run database update 0111 first." : error.message);
    out.push({ id, title, kind, count: Number(f.count ?? 0) || 0 });
  }
  const order: Record<FormKind, number> = { credit: 0, account: 1, prf: 2, other: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
}

/** Every submission Jotform has for a form, right now. */
async function liveSubs(formId: string): Promise<Submission[]> {
  const all: Submission[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const page = await liveApi<Submission[]>(`/form/${formId}/submissions?limit=1000&offset=${offset}&orderby=created_at&filter=${DELETED}`, false);
    all.push(...(page ?? []).filter((s) => s.status !== "DELETED"));
    if (!page || page.length < 1000) break;
  }
  return all;
}

/** Step 2: one form's submissions (all answers), and the files on them that aren't saved yet. */
export async function archiveSubs(db: SupabaseClient, formId: string): Promise<{ subs: number; files: number; pending: PendingFile[] }> {
  const subs = await liveSubs(formId);
  const rows = subs.map((s) => ({ id: String(s.id), form_id: formId, created_at: s.created_at ? new Date(`${s.created_at.replace(" ", "T")}Z`).toISOString() : null, raw: s, file_urls: fileUrls(s), archived_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("jotform_archive_subs").upsert(rows.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  await db.from("jotform_archive_forms").update({ live_count: rows.length, archived_at: new Date().toISOString() }).eq("form_id", formId);
  const want = rows.flatMap((r) => r.file_urls.map((url) => ({ url, sub: r.id })));
  const have = new Set<string>();
  for (let i = 0; i < want.length; i += 300) {
    const { data } = await db.from("jotform_archive_files").select("url").in("url", want.slice(i, i + 300).map((w) => w.url));
    for (const r of (data ?? []) as { url: string }[]) have.add(r.url);
  }
  return { subs: rows.length, files: want.length, pending: want.filter((w) => !have.has(w.url)) };
}

const safeName = (u: string) =>
  (decodeURIComponent(new URL(u).pathname.split("/").pop() ?? "file").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file").slice(-90);

/** Step 3: a few files at a time, from Jotform into A.I.'s private file storage. */
export async function archiveFiles(db: SupabaseClient, formId: string, items: PendingFile[]): Promise<{ saved: number; failed: { url: string; why: string }[] }> {
  let saved = 0;
  const failed: { url: string; why: string }[] = [];
  await Promise.all(
    items.slice(0, 8).map(async ({ url, sub }) => {
      if (!isJotformFile(url)) return void failed.push({ url, why: "Not a Jotform file" });
      const file = await liveJotformFile(url).catch(() => null);
      if (!file) return void failed.push({ url, why: "Jotform wouldn't send it" });
      const path = `${formId}/${sub}/${createHash("sha1").update(url).digest("hex").slice(0, 10)}-${safeName(url)}`;
      const up = await db.storage.from(ARCHIVE_BUCKET).upload(path, file.body, { contentType: file.type || "application/octet-stream", upsert: true });
      if (up.error) return void failed.push({ url, why: up.error.message });
      const { error } = await db.from("jotform_archive_files").upsert({ url, submission_id: sub, form_id: formId, path, type: file.type, size: file.body.byteLength, saved_at: new Date().toISOString() });
      if (error) return void failed.push({ url, why: error.message });
      saved++;
    }),
  );
  return { saved, failed };
}

export type FormCheck = { id: string; title: string; kind: string; jotform: number | null; copied: number; files: number; filesSaved: number; missingSubs: string[]; missingFiles: number };

/** The check: for every form, Jotform's count right now against the copy, and files on the copy against files saved. */
export async function archiveCheck(db: SupabaseClient, live: boolean): Promise<FormCheck[]> {
  const { data: forms } = await db.from("jotform_archive_forms").select("form_id, title, kind, live_count").order("title");
  const out: FormCheck[] = [];
  for (const f of (forms ?? []) as { form_id: string; title: string; kind: string; live_count: number | null }[]) {
    const subs: { id: string; file_urls: string[] }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("jotform_archive_subs").select("id, file_urls").eq("form_id", f.form_id).range(from, from + 999);
      subs.push(...((data ?? []) as { id: string; file_urls: string[] }[]));
      if (!data || data.length < 1000) break;
    }
    const urls = [...new Set(subs.flatMap((s) => s.file_urls ?? []))];
    let saved = 0;
    for (let i = 0; i < urls.length; i += 300) {
      const { count } = await db.from("jotform_archive_files").select("url", { count: "exact", head: true }).in("url", urls.slice(i, i + 300));
      saved += count ?? 0;
    }
    let jot: number | null = f.live_count;
    let missingSubs: string[] = [];
    if (live) {
      const now = await liveSubs(f.form_id).catch(() => null);
      if (now) {
        jot = now.length;
        const have = new Set(subs.map((s) => s.id));
        missingSubs = now.filter((s) => !have.has(String(s.id))).map((s) => String(s.id));
      } else jot = null;
    }
    out.push({ id: f.form_id, title: f.title, kind: f.kind, jotform: jot, copied: subs.length, files: urls.length, filesSaved: saved, missingSubs, missingFiles: urls.length - saved });
  }
  return out;
}
