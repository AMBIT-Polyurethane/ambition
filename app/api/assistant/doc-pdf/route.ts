import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

// Admins only: hands the browser the PDF behind a Docs-library document (a file in storage, or a link
// on ambitpu.com), so Admin → Ask AMBIT can read its words. Only documents already in the library.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 60 * 1024 * 1024;

export async function GET(request: Request) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin" || s.profile.status !== "active") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const { data: doc } = await s.supabase.from("documents").select("url, storage_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  let bytes: ArrayBuffer | null = null;
  if (doc.storage_path) {
    const { data } = await s.supabase.storage.from("docs").download(doc.storage_path);
    if (data) bytes = await data.arrayBuffer();
  } else if (doc.url && /^https:\/\//i.test(doc.url)) {
    try {
      const r = await fetch(doc.url, { redirect: "follow", signal: AbortSignal.timeout(45_000) });
      const len = Number(r.headers.get("content-length") ?? 0);
      if (r.ok && len <= MAX) bytes = await r.arrayBuffer();
    } catch {}
  }
  if (!bytes) return NextResponse.json({ error: "Couldn't get the PDF" }, { status: 502 });
  if (bytes.byteLength > MAX) return NextResponse.json({ error: "PDF too large" }, { status: 413 });
  const head = new Uint8Array(bytes.slice(0, 5));
  if (String.fromCharCode(...head) !== "%PDF-") return NextResponse.json({ error: "That link isn't a PDF" }, { status: 415 });
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
