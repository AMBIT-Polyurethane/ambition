import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";

// A.I.'s own copy of Jotform (0111). lib/jotform.ts asks here whenever Jotform itself can't answer (or always, once
// JOTFORM_ARCHIVE_ONLY=1 is set in Vercel after Jotform is cancelled). Server only: credit applications can hold
// private details, so the tables have no read rules and only the app's server key reads them.

export const ARCHIVE_BUCKET = "jotform-archive";

/** Jotform is gone: answer from the copy without trying Jotform first. */
export const archiveOnly = () => /^(1|true|yes)$/i.test((process.env.JOTFORM_ARCHIVE_ONLY ?? "").trim());

const db = () => (serviceReady() ? serviceClient() : null);

/**
 * The same answer Jotform's API would give for this path, from the copy. undefined = not in the copy.
 * Paths the app uses: /user/forms, /form/{id}, /form/{id}/questions, /form/{id}/submissions, /submission/{id}.
 */
export async function fromArchive<T>(path: string): Promise<T | undefined> {
  const c = db();
  if (!c) return undefined;
  const [p, query = ""] = path.split("?");
  const qs = new URLSearchParams(query);
  let m: RegExpMatchArray | null;
  if (p === "/user/forms") {
    const { data, error } = await c.from("jotform_archive_forms").select("raw").order("title");
    if (error || !data?.length) return undefined;
    return data.map((r) => r.raw) as T;
  }
  if ((m = p.match(/^\/form\/(\d{6,25})$/))) {
    const { data } = await c.from("jotform_archive_forms").select("raw").eq("form_id", m[1]).maybeSingle();
    return (data?.raw ?? undefined) as T | undefined;
  }
  if ((m = p.match(/^\/form\/(\d{6,25})\/questions$/))) {
    const { data } = await c.from("jotform_archive_forms").select("questions").eq("form_id", m[1]).maybeSingle();
    return (data?.questions ?? undefined) as T | undefined;
  }
  if ((m = p.match(/^\/form\/(\d{6,25})\/submissions$/))) {
    const { data: f } = await c.from("jotform_archive_forms").select("form_id").eq("form_id", m[1]).maybeSingle();
    if (!f) return undefined;
    const limit = Math.min(1000, Math.max(1, Number(qs.get("limit") ?? 20) || 20));
    const offset = Math.max(0, Number(qs.get("offset") ?? 0) || 0);
    const { data } = await c.from("jotform_archive_subs").select("raw").eq("form_id", m[1]).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    return (data ?? []).map((r) => r.raw) as T;
  }
  if ((m = p.match(/^\/submission\/(\d{6,25})$/))) {
    const { data } = await c.from("jotform_archive_subs").select("raw").eq("id", m[1]).maybeSingle();
    return (data?.raw ?? undefined) as T | undefined;
  }
  return undefined;
}

/** A Jotform upload or signature from the copy (null when it wasn't copied). */
export async function archivedFile(url: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const c = db();
  if (!c) return null;
  const { data: row } = await c.from("jotform_archive_files").select("path, type").eq("url", url).maybeSingle<{ path: string; type: string | null }>();
  if (!row) return null;
  const { data: blob, error } = await c.storage.from(ARCHIVE_BUCKET).download(row.path);
  if (error || !blob) return null;
  return { body: await blob.arrayBuffer(), type: row.type || blob.type || "application/octet-stream" };
}
