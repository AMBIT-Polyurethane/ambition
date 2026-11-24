"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { archiveCheck, archiveFiles, archiveForms, archiveSubs, type ArchiveForm, type FormCheck, type PendingFile } from "@/lib/jotform-archive";
import { extraForms } from "../reviews";

// Admin › Forms hub › Copy from Jotform (0111). Each step is its own call so no single one runs long.

type R<T> = ({ ok: true } & T) | { ok: false; error: string };
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

async function start() {
  const s = await requireAdmin();
  if (!serviceReady()) throw new Error("SUPABASE_SECRET_KEY isn't set in Vercel.");
  if (!process.env.JOTFORM_API_KEY?.trim()) throw new Error("The Jotform key (JOTFORM_API_KEY) isn't in Vercel, so there's nothing to copy from.");
  return { ...s, db: serviceClient() };
}

export async function copyForms(): Promise<R<{ forms: ArchiveForm[] }>> {
  try {
    const s = await start();
    return { ok: true, forms: await archiveForms(s.db, await extraForms(s.supabase), s.profile.full_name ?? s.profile.email) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function copySubs(formId: string): Promise<R<{ subs: number; files: number; pending: PendingFile[] }>> {
  try {
    if (!/^\d{6,25}$/.test(formId)) return { ok: false, error: "Unknown form." };
    const s = await start();
    return { ok: true, ...(await archiveSubs(s.db, formId)) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function copyFiles(formId: string, items: PendingFile[]): Promise<R<{ saved: number; failed: { url: string; why: string }[] }>> {
  try {
    if (!/^\d{6,25}$/.test(formId)) return { ok: false, error: "Unknown form." };
    const s = await start();
    return { ok: true, ...(await archiveFiles(s.db, formId, items.slice(0, 8))) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function checkCopy(): Promise<R<{ forms: FormCheck[] }>> {
  try {
    await requireAdmin();
    if (!serviceReady()) return { ok: false, error: "SUPABASE_SECRET_KEY isn't set in Vercel." };
    const forms = await archiveCheck(serviceClient(), Boolean(process.env.JOTFORM_API_KEY?.trim()));
    revalidatePath("/admin/forms/archive");
    return { ok: true, forms };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
