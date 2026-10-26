"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { ACCOUNTING_EMAIL } from "@/lib/env";
import { emailConfigured, sendEmail, wrapEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { CERT_KINDS } from "@/lib/tax";

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type NewCert = {
  companyId: string;
  state: string;
  cert_number: string;
  kind: string;
  issued_on: string;
  expires_on: string;
  no_expiration: boolean;
  file_path: string | null;
  file_name: string | null;
  note: string;
};

/** Accounting adds a certificate (verified right away); a contractor uploads a renewal (Accounting verifies it). */
export async function addCertificate(c: NewCert): Promise<{ ok?: boolean; error?: string }> {
  const { supabase, profile } = await requireActive();
  const manager = can(profile, "credit_check");
  const companyId = manager ? c.companyId : profile.company_id ?? "";
  if (!UUID.test(companyId)) return { error: "Customer not found." };
  if (!c.no_expiration && !DATE.test(c.expires_on)) return { error: "Enter the expiration date, or tick “No expiration date”." };
  if (!c.file_path && !manager) return { error: "Add a photo or PDF of the certificate." };
  if (c.file_path && !c.file_path.startsWith(`${companyId}/`)) return { error: "Upload the file again." };

  const row = {
    company_id: companyId,
    state: c.state ? c.state.slice(0, 20) : null,
    cert_number: c.cert_number.trim().slice(0, 100) || null,
    kind: CERT_KINDS.some((k) => k.id === c.kind) ? c.kind : null,
    issued_on: DATE.test(c.issued_on) ? c.issued_on : null,
    expires_on: c.no_expiration ? null : c.expires_on,
    no_expiration: Boolean(c.no_expiration),
    file_path: c.file_path,
    file_name: c.file_name?.slice(0, 200) ?? null,
    status: "pending",
    note: c.note.trim().slice(0, 1000) || null,
    uploaded_by: profile.id,
    uploaded_by_name: profile.full_name || profile.email,
    uploaded_by_role: profile.role,
  };
  const { data, error } = await supabase.from("tax_certificates").insert(row).select("id").single();
  if (error || !data) return { error: "Couldn't save the certificate." };

  if (manager) {
    const { error: vErr } = await supabase.rpc("tax_cert_decide", { p_cert: data.id, p_verify: true, p_note: null });
    if (vErr) return { error: vErr.message };
  } else if (ACCOUNTING_EMAIL && emailConfigured()) {
    const origin = await currentOrigin();
    const who = profile.company?.name ?? profile.full_name ?? profile.email;
    await sendEmail({
      to: [ACCOUNTING_EMAIL],
      subject: `New tax-exempt certificate to verify: ${who}`,
      text: `${profile.full_name || profile.email} (${who}) uploaded a tax-exempt certificate. Verify it: ${origin}/tax/${companyId}`,
      html: wrapEmail(
        "Tax certificate",
        `<p style="margin:0 0 14px;font-size:15px;"><b>${esc(profile.full_name || profile.email)}</b> (${esc(who)}) uploaded a new tax-exempt certificate.</p>
<p style="margin:0;"><a href="${origin}/tax/${companyId}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:800;letter-spacing:1px;padding:12px 18px;border-radius:8px;">VERIFY IT</a></p>`,
      ),
    });
  }
  revalidatePath("/tax");
  revalidatePath(`/tax/${companyId}`);
  revalidatePath("/profile");
  revalidatePath("/");
  return { ok: true };
}

export async function decideCertificate(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireActive();
  if (!can(profile, "credit_check")) return;
  const id = String(formData.get("id") ?? "");
  const company = String(formData.get("company") ?? "");
  const verify = formData.get("decision") === "verify";
  // Accounting can fix the dates before verifying.
  const expires = String(formData.get("expires_on") ?? "");
  const noExp = formData.get("no_expiration") === "on";
  if (verify && (DATE.test(expires) || noExp)) {
    await supabase.from("tax_certificates").update({ expires_on: noExp ? null : expires, no_expiration: noExp, updated_at: new Date().toISOString() }).eq("id", id);
  }
  const { error } = await supabase.rpc("tax_cert_decide", { p_cert: id, p_verify: verify, p_note: String(formData.get("note") ?? "") || null });
  revalidatePath(`/tax/${company}`);
  revalidatePath("/tax");
  revalidatePath("/");
  redirect(`/tax/${company}?${new URLSearchParams(error ? { err: error.message } : { msg: verify ? "Certificate verified. Orders from this customer can be released." : "Certificate turned down." })}`);
}

export async function deleteCertificate(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireActive();
  if (!can(profile, "credit_check")) return;
  const id = String(formData.get("id") ?? "");
  const company = String(formData.get("company") ?? "");
  const { data } = await supabase.from("tax_certificates").select("file_path").eq("id", id).maybeSingle();
  await supabase.from("tax_certificates").delete().eq("id", id);
  if (data?.file_path) await supabase.storage.from("tax-certs").remove([data.file_path]);
  revalidatePath(`/tax/${company}`);
  redirect(`/tax/${company}?msg=${encodeURIComponent("Certificate removed.")}`);
}

export async function setTaxExempt(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireActive();
  if (!can(profile, "credit_check")) return;
  const company = String(formData.get("company") ?? "");
  const on = formData.get("on") === "yes";
  const { error } = await supabase.rpc("company_set_tax_exempt", { p_company: company, p_on: on });
  revalidatePath(`/tax/${company}`);
  revalidatePath("/tax");
  redirect(`/tax/${company}?${new URLSearchParams(error ? { err: error.message } : { msg: on ? "Marked tax-exempt." : "Marked as not tax-exempt." })}`);
}
