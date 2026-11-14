"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { isEmployee } from "@/lib/session";
import { serviceClient } from "@/lib/supabase/service";
import { sendEmail, wrapEmail } from "@/lib/email";
import { sendPush } from "@/lib/push";
import { currentOrigin } from "@/lib/origin";
import { check, mask, secretFields, str, tidy, type Data } from "@/lib/forms/engine";
import { SPECS } from "@/lib/forms/specs";
import { newToken, open, seal } from "@/lib/forms/crypto";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; fields?: Record<string, string> };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

type Row = { id: number; form_key: string; ref_no: string | null; status: string; data: Data; secrets: string | null; company_id: string | null; price_request_id: number | null;
  public_token: string | null; token_expires: string | null; submitted_by: string | null; created_by: string | null; for_day: string | null };

/** Pull SSN / bank / license numbers out of the answers, encrypt them, and leave only "•••• 1234" behind. */
function splitSecrets(key: string, data: Data, keep: Record<string, string>) {
  const out = { ...data };
  const secret: Record<string, string> = { ...keep };
  for (const f of secretFields(SPECS[key])) {
    const v = str(data[f.k]).trim();
    if (v && !v.startsWith("••••")) secret[f.k] = v.replace(/[^\dA-Za-z-]/g, "");
    if (secret[f.k]) out[f.k] = mask(secret[f.k]);
    else delete out[f.k];
  }
  return { data: out, secrets: Object.keys(secret).length ? seal(secret) : null, kept: Object.keys(secret) };
}

/** Everyone who should hear about a new submission of this form. */
async function reviewers(key: string): Promise<{ id: string; email: string }[]> {
  const db = serviceClient();
  const { data } = await db.from("profiles").select("id, email, role, perms, status").eq("status", "active").in("role", ["admin", "employee"]);
  const want = key === "credit_app" || key === "account_setup" ? ["credit_check", "add_customers"] : key === "rma" ? ["order_desk", "complaints"] : key === "spray_data" ? ["spray_log"] : [];
  return ((data ?? []) as { id: string; email: string; role: string; perms: string[] | null }[]).filter((p) => p.role === "admin" || want.some((w) => (p.perms ?? []).includes(w)));
}

async function tell(row: Row, who: string) {
  const spec = SPECS[row.form_key];
  if (!spec) return;
  const origin = await currentOrigin();
  const url = `${origin}/forms/s/${row.id}`;
  let to: { id: string; email: string }[] = [];
  let urgent = "";
  if (spec.group === "pulse") {
    const sc = spec.score?.(row.data);
    if (!sc?.flags.some((f) => f !== "Blocked")) return; // only real alerts interrupt leadership
    urgent = sc.flags.join(", ");
    to = (await reviewers(row.form_key)).filter(Boolean);
  } else if (spec.group === "team") {
    const mgr = str(row.data.manager);
    const db = serviceClient();
    if (UUID.test(mgr)) { const { data } = await db.from("profiles").select("id, email").eq("id", mgr).maybeSingle(); if (data) to = [data as { id: string; email: string }]; }
    if (!to.length) to = await reviewers(row.form_key);
  } else to = await reviewers(row.form_key);
  if (!to.length) return;
  const title = urgent ? `${spec.title}: ${urgent}` : `${spec.title} ${row.ref_no ?? ""}`.trim();
  const line = spec.summary(row.data);
  await sendPush(to.map((t) => t.id), { title, body: `${who}${line ? ` · ${line}` : ""}`, url: `/forms/s/${row.id}`, tag: `form-${row.id}` }).catch(() => 0);
  await sendEmail({
    to: to.map((t) => t.email), subject: title,
    html: wrapEmail(spec.title, `<p style="margin:0 0 8px;font-size:16px;"><b>${esc(title)}</b></p><p style="margin:0 0 16px;color:#52525b;">From ${esc(who)}${line ? ` · ${esc(line)}` : ""}</p><p><a href="${url}" style="background:#E33527;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;">Open it</a></p>`),
    text: `${title}\nFrom ${who}${line ? ` · ${line}` : ""}\n${url}`,
  }).catch(() => null);
}

/**
 * Save a form. Staff fill forms in the app; a customer fills a credit application or account setup from the link we
 * emailed them (token). Drafts save without checking; a submit is checked against the form's rules again here.
 */
export async function saveForm(input: { key: string; data: Data; id?: number; token?: string; draft?: boolean; prf?: number | null; company?: string | null; forDay?: string | null }): Promise<Res<{ id: number; ref: string | null }>> {
  const spec = SPECS[input.key];
  if (!spec) return { ok: false, error: "That form doesn't exist." };
  const db = serviceClient();
  let row: Row | null = null;
  let staff = false;
  let who = "";
  let uid: string | null = null;
  if (input.token) {
    const { data } = await db.from("form_submissions").select("*").eq("public_token", input.token).maybeSingle();
    row = data as Row | null;
    if (!row || row.form_key !== input.key) return { ok: false, error: "This link isn't valid. Ask your AMBIT rep for a new one." };
    if (!["sent", "draft"].includes(row.status)) return { ok: false, error: "This form was already sent to AMBIT. Thank you!" };
    if (row.token_expires && new Date(row.token_expires) < new Date()) return { ok: false, error: "This link has expired. Ask your AMBIT rep for a new one." };
    who = str(input.data.company_name) || "The customer";
  } else {
    const s = await getSession();
    if (!s?.profile || s.profile.status !== "active" || !isEmployee(s.profile)) return { ok: false, error: "Sign in again." };
    staff = true;
    uid = s.profile.id;
    who = s.profile.full_name || s.profile.email;
    if (input.id) {
      const { data } = await s.supabase.from("form_submissions").select("*").eq("id", input.id).maybeSingle(); // RLS: theirs, or they review it
      row = data as Row | null;
      if (!row) return { ok: false, error: "That form isn't yours to change." };
      if (!["draft", "sent", "submitted"].includes(row.status)) return { ok: false, error: "It's already been decided, so it can't change." };
    }
    if (spec.group === "pulse") {
      const forDay = input.forDay && /^\d{4}-\d{2}-\d{2}$/.test(input.forDay) ? input.forDay : day();
      const { data } = await db.from("form_submissions").select("*").eq("form_key", input.key).eq("submitted_by", uid).eq("for_day", forDay).maybeSingle();
      if (data) row = data as Row;
      input.forDay = forDay;
    }
  }
  let kept: Record<string, string> = {};
  try { kept = open(row?.secrets); } catch { kept = {}; }
  const clean = tidy(spec, input.data, staff);
  let split: ReturnType<typeof splitSecrets>;
  try { split = splitSecrets(input.key, clean, kept); } catch (e) { return { ok: false, error: (e as Error).message }; }
  if (!input.draft) {
    const errs = check(spec, input.data, { staff, secretsKept: split.kept });
    if (Object.keys(errs).length) return { ok: false, error: "A few things still need filling in.", fields: errs };
  }
  // The AMBIT-only section (staff fill it in) survives a customer saving their part.
  const data = { ...split.data };
  if (row?.data && !staff) for (const st of spec.steps) if (st.staffOnly) for (const f of st.fields) if (f.k in row.data) data[f.k] = row.data[f.k];
  const score = spec.score?.(data) ?? null;
  const company = (input.company && UUID.test(input.company) ? input.company : null) ?? (UUID.test(str(data.company_id)) ? str(data.company_id) : null) ?? row?.company_id ?? null;
  const patch = {
    data, secrets: split.secrets, score: score ? score.pct : null, company_id: company,
    price_request_id: input.prf ?? row?.price_request_id ?? null,
    status: input.draft ? (row?.status === "sent" ? "sent" : "draft") : "submitted",
    submitted_by: input.draft ? row?.submitted_by ?? null : uid ?? row?.submitted_by ?? null,
    submitted_name: input.draft ? null : who,
    submitted_at: input.draft ? null : new Date().toISOString(),
    for_day: spec.group === "pulse" ? input.forDay ?? day() : row?.for_day ?? null,
    updated_at: new Date().toISOString(),
  };
  let saved: Row;
  if (row) {
    const { data: up, error } = await db.from("form_submissions").update({ ...patch, ref_no: row.ref_no ?? (input.draft ? null : (await db.rpc("form_ref", { p_key: input.key })).data) }).eq("id", row.id).select("*").single();
    if (error) return { ok: false, error: error.message };
    saved = up as Row;
  } else {
    const ref = input.draft ? null : ((await db.rpc("form_ref", { p_key: input.key })).data as string | null);
    const { data: ins, error } = await db.from("form_submissions").insert({ ...patch, form_key: input.key, ref_no: ref, created_by: uid }).select("*").single();
    if (error) return { ok: false, error: /form_submissions/.test(error.message) ? "Forms need the 0068 database update first." : error.message };
    saved = ins as Row;
  }
  if (!input.draft) await tell(saved, who).catch(() => null);
  revalidatePath("/forms", "layout");
  return { ok: true, id: saved.id, ref: saved.ref_no };
}

/** Staff: email a customer a link to fill in the Credit Application or Account Setup themselves (good for 30 days). */
export async function sendFormLink(input: { key: "credit_app" | "account_setup"; email: string; name: string; prf?: number | null; company?: string | null; prefill?: Data }): Promise<Res<{ id: number; url: string; emailed: boolean }>> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return { ok: false, error: "Sign in again." };
  const spec = SPECS[input.key];
  if (!spec?.publicLink) return { ok: false, error: "That form can't be sent to a customer." };
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Type the customer's email." };
  const db = serviceClient();
  const token = newToken();
  const { data: row, error } = await db.from("form_submissions").insert({
    form_key: input.key, status: "sent", data: tidy(spec, input.prefill ?? {}, false), public_token: token,
    token_expires: new Date(Date.now() + 30 * 864e5).toISOString(), company_id: input.company && UUID.test(input.company) ? input.company : null,
    price_request_id: input.prf ?? null, created_by: s.profile.id, submitted_name: input.name.trim().slice(0, 160) || null,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  const url = `${await currentOrigin()}/f/${token}`;
  const rep = s.profile.full_name || "your AMBIT rep";
  const r = await sendEmail({
    to: [email], replyTo: s.profile.email, fromName: "AMBIT Polyurethane", subject: `AMBIT ${spec.title}`,
    html: wrapEmail(spec.title, `<p style="margin:0 0 12px;font-size:16px;">Hi ${esc(input.name.trim() || "there")},</p><p style="margin:0 0 16px;">${esc(rep)} sent you AMBIT's ${esc(spec.title.toLowerCase())}. It takes about 5 minutes on your phone or computer.</p><p><a href="${url}" style="background:#E33527;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;">Fill it in</a></p><p style="font-size:12px;color:#71717a;">The link works for 30 days. Private numbers (SSN, bank account) are encrypted.</p>`),
    text: `${rep} sent you AMBIT's ${spec.title}. Fill it in here (good for 30 days): ${url}`,
  }).catch(() => ({ status: "failed" as const }));
  revalidatePath("/forms", "layout");
  return { ok: true, id: (row as { id: number }).id, url, emailed: r.status === "sent" };
}

/** Reviewers: approve or deny. A credit app can set the customer's line; an account setup can create the customer. */
export async function decideForm(input: { id: number; status: "approved" | "denied" | "closed"; note?: string; limit?: string; terms?: string; createCustomer?: boolean }): Promise<Res<{ company?: string | null }>> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return { ok: false, error: "Sign in again." };
  const { data: row } = await s.supabase.from("form_submissions").select("*").eq("id", input.id).maybeSingle();
  const r = row as Row | null;
  if (!r) return { ok: false, error: "Not found." };
  const { data: canReview } = await s.supabase.rpc("form_reviewer", { p_key: r.form_key });
  const mgr = str(r.data.manager) === s.profile.id;
  if (!canReview && !mgr) return { ok: false, error: "Only a reviewer can decide this." };
  const db = serviceClient();
  let company = r.company_id;
  if (input.status === "approved" && r.form_key === "account_setup" && input.createCustomer && !company) {
    const d = r.data;
    const { data: co, error } = await db.from("companies").insert({
      name: str(d.company_name), phone: str(d.company_phone), email: str(d.company_email), city: str(d.company_city), state: str(d.company_state).toUpperCase(),
      contact_name: str(d.purchaser), bill_address: [str(d.company_street), `${str(d.company_city)}, ${str(d.company_state)} ${str(d.company_zip)}`].join("\n"),
      ship_address: str(d.ship_same) === "No" ? [str(d.ship_street), `${str(d.ship_city)}, ${str(d.ship_state)} ${str(d.ship_zip)}`].join("\n") : null,
      tax_exempt: str(d.tax_exempt) === "Yes", sales_rep_id: UUID.test(str(d.rep)) ? str(d.rep) : null, source: "admin", needs_qb_setup: true, created_by: s.profile.id, active: true,
    }).select("id").single();
    if (error) return { ok: false, error: `Couldn't create the customer: ${error.message}` };
    company = (co as { id: string }).id;
    if (r.price_request_id) await s.supabase.rpc("price_request_link", { p_request: r.price_request_id, p_company: company });
    // the credit application from the same price request belongs to them too
    if (r.price_request_id) await db.from("form_submissions").update({ company_id: company }).eq("price_request_id", r.price_request_id).is("company_id", null);
  }
  if (input.status === "approved" && r.form_key === "credit_app" && company && input.limit) {
    const lim = Number(input.limit.replace(/[$,\s]/g, ""));
    if (Number.isFinite(lim) && lim >= 0) await s.supabase.rpc("credit_profile_set", { p_company: company, p_status: "line", p_limit: lim, p_terms: input.terms?.trim() || null, p_note: `Credit application ${r.ref_no ?? ""} approved`, p_parent: null, p_manual: null, p_flags: null });
  }
  const { error } = await db.from("form_submissions").update({
    status: input.status, decided_by_name: s.profile.full_name || s.profile.email, decided_at: new Date().toISOString(),
    decision_note: input.note?.trim().slice(0, 2000) || null, company_id: company, updated_at: new Date().toISOString(),
  }).eq("id", r.id);
  if (error) return { ok: false, error: error.message };
  if (r.submitted_by && r.submitted_by !== s.profile.id) {
    const spec = SPECS[r.form_key];
    await sendPush([r.submitted_by], { title: `${spec?.title ?? "Form"} ${input.status}`, body: input.note?.trim() || r.ref_no || "", url: `/forms/s/${r.id}` }).catch(() => 0);
  }
  revalidatePath("/forms", "layout");
  return { ok: true, company };
}

/** Admins and Accounting: show one private number (it's never sent to the browser unless someone asks). */
export async function revealSecret(id: number, field: string): Promise<Res<{ value: string }>> {
  const s = await getSession();
  if (!s?.profile || !(s.profile.role === "admin" || (s.profile.perms ?? []).includes("credit_check"))) return { ok: false, error: "Only admins and Accounting can see private numbers." };
  const { data: row } = await s.supabase.from("form_submissions").select("id, secrets, form_key").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "Not found." };
  try {
    const v = open((row as { secrets: string | null }).secrets)[field];
    return v ? { ok: true, value: v } : { ok: false, error: "Nothing saved." };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
