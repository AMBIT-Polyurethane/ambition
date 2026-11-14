import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/session";
import { isEmployee } from "@/lib/session";
import { serviceClient } from "@/lib/supabase/service";

// Files on forms (photo ID, EIN letter, driver's license, RMA photos): a signed-in employee, or a customer holding a
// valid form link. They go in the private "forms" bucket; only reviewers can open them (through /forms/file).
const OK = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const MAX = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const token = String(form?.get("token") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "That file is over 15 MB. Try a photo instead." }, { status: 400 });
  if (!OK.test(file.type)) return NextResponse.json({ error: "Use a photo or a PDF." }, { status: 400 });
  const db = serviceClient();
  let folder = "";
  if (token) {
    const { data } = await db.from("form_submissions").select("id, status, token_expires").eq("public_token", token).maybeSingle();
    const r = data as { id: number; status: string; token_expires: string | null } | null;
    if (!r || !["sent", "draft"].includes(r.status) || (r.token_expires && new Date(r.token_expires) < new Date())) return NextResponse.json({ error: "This link isn't valid anymore." }, { status: 403 });
    folder = `link-${r.id}`;
  } else {
    const s = await getSession();
    if (!s?.profile || !isEmployee(s.profile)) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    folder = s.profile.id;
  }
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${folder}/${randomUUID()}.${ext}`;
  const { error } = await db.storage.from("forms").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ path, name: file.name.slice(0, 120), type: file.type, size: file.size });
}
