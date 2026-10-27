"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { sendEmail, wrapEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { escapeHtml as h, firstName } from "@/lib/format";
import type { DocumentRow, Profile } from "@/lib/types";
import { DOC_TYPES, fileKind, parseProducts, storageKeyFor } from "@/lib/docs";
import { CUSTOMER_PRICED_CATEGORIES, normalizeProductRows } from "@/lib/product-import";
import { PERM_KEYS } from "@/lib/access";
import { sqftFromName } from "@/lib/sqft";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => (s(f, k) === "" ? null : s(f, k));
const num = (v: unknown): number | null => {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  if (t === "") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};
const slug = (t: string) => t.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export type ImportResult = { ok: boolean; message: string };

// ------------------------------------------------------------------ accounts
export async function saveUser(form: FormData) {
  const { supabase } = await requireAdmin();
  const userId = s(form, "user_id");
  const role = s(form, "role") as Profile["role"];
  const status = s(form, "status") as Profile["status"];
  const tab = s(form, "tab") || "pending";
  let companyId: string | null = n(form, "company_id");
  const branchId = n(form, "branch_id");
  const back = (q: string) => `/admin/users?tab=${encodeURIComponent(tab)}&${q}`;

  const { data: before } = await supabase.from("profiles").select("*").eq("id", userId).single<Profile>();
  if (!before) redirect(back("error=" + encodeURIComponent("That account no longer exists.")));

  const staff = role === "employee" || role === "admin";
  if (staff && !before.email.toLowerCase().endsWith("@ambitpu.com")) {
    redirect(back("error=" + encodeURIComponent(`${before.email} isn't an @ambitpu.com address, so it can only be a contractor account.`)));
  }

  if (!staff && companyId === "__new") {
    const name = before.requested_company || before.full_name || before.email;
    const { data: created, error } = await supabase
      .from("companies")
      .insert({ name, account_no: before.requested_account_no || null, default_branch_id: branchId ?? before.branch_id, phone: before.phone, email: before.email })
      .select("id")
      .single();
    if (error) {
      // Account number already used: link to that company instead.
      const { data: existing } = await supabase.from("companies").select("id").eq("account_no", before.requested_account_no ?? "").maybeSingle();
      companyId = existing?.id ?? null;
    } else {
      companyId = created.id;
    }
  }

  const { error } = await supabase.rpc("admin_update_user", {
    p_user: userId,
    p_role: role,
    p_status: status,
    p_company: staff ? null : companyId === "__new" ? null : companyId,
    p_branch: branchId,
  });
  if (error) redirect(back("error=" + encodeURIComponent(error.message)));

  // Staff: job role and what they see. (Skipped quietly if the roles update hasn't been run yet.)
  if (staff) {
    const jobRole = role === "admin" ? "admin" : n(form, "job_role");
    const perms = role === "admin" ? PERM_KEYS : form.getAll("perms").map(String).filter((k) => (PERM_KEYS as string[]).includes(k));
    const { error: accessError } = await supabase.rpc("admin_set_access", { p_user: userId, p_job_role: jobRole, p_perms: perms });
    if (accessError && !/admin_set_access|could not find the function|schema cache/i.test(accessError.message)) {
      redirect(back("error=" + encodeURIComponent(accessError.message)));
    }
  }

  if (before.status !== "active" && status === "active") {
    const origin = await currentOrigin();
    await sendEmail({
      to: [before.email],
      subject: "You're approved for AMBIT Intelligence",
      html: wrapEmail(
        "Welcome",
        `<div style="font-size:22px;font-weight:800;margin-bottom:10px;">You're in, ${h(firstName(before.full_name, before.email))}.</div>
<p style="font-size:15px;line-height:1.5;margin:0 0 18px;">Your AMBIT Intelligence account is approved. ${
          staff
            ? "You now have the AMBIT team side of the app: internal forms, the company directory, ordering for customers, docs and AMBIT Academy."
            : "You can now place orders, find product docs and bulletins, and take AMBIT Academy courses."
        }</p>
<p style="margin:0;"><a href="${h(origin)}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:12px 18px;border-radius:8px;">OPEN AMBIT A.I.</a></p>
<p style="font-size:13px;color:#52525b;margin:18px 0 0;">Tip: on your phone, open the link and choose "Add to Home Screen" to use it like an app.</p>`,
      ),
      text: `Your AMBIT Intelligence account is approved. Open ${origin}`,
    }).catch(() => null);
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  redirect(back("saved=" + encodeURIComponent(before.full_name || before.email)));
}

// ----------------------------------------------------------------- companies
export async function saveCompany(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const row = {
    name: s(form, "name"),
    account_no: n(form, "account_no"),
    default_branch_id: n(form, "default_branch_id"),
    contact_name: n(form, "contact_name"),
    phone: n(form, "phone"),
    email: n(form, "email"),
    city: n(form, "city"),
    state: n(form, "state"),
    bill_address: n(form, "bill_address"),
    ship_address: n(form, "ship_address"),
    notes: n(form, "notes"),
    active: id ? form.get("active") === "on" : true,
    needs_qb_setup: form.get("needs_qb_setup") === "on",
  };
  if (!row.name) return;
  if (id) await supabase.from("companies").update(row).eq("id", id);
  else await supabase.from("companies").insert(row);
  revalidatePath("/admin/companies");
}

export async function importCompanies(rows: Record<string, string>[]): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  const { data: branches } = await supabase.from("branches").select("id, name");
  const branchFor = (v: string) => {
    const t = (v || "").trim().toLowerCase();
    if (!t) return null;
    return (branches ?? []).find((b) => b.id === t || b.name.toLowerCase() === t || t.startsWith(b.name.toLowerCase()))?.id ?? null;
  };
  const { data: existing } = await supabase.from("companies").select("id, name, account_no, qb_id");
  const byQb = new Map((existing ?? []).filter((c) => c.qb_id).map((c) => [String(c.qb_id), c.id]));
  const byAcct = new Map((existing ?? []).filter((c) => c.account_no).map((c) => [String(c.account_no).toLowerCase(), c.id]));
  const byName = new Map((existing ?? []).map((c) => [c.name.toLowerCase(), c.id]));
  const t = (v: string | undefined) => (v ?? "").trim() || null;

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const toInsert: Record<string, string | null>[] = [];
  for (const r of rows) {
    const name = (r.name || r.company || r.customer || "").trim().replace(/\s+/g, " ");
    if (!name) { skipped++; continue; }
    if (name.toLowerCase().startsWith("example")) continue; // the template's example row
    const acct = t(r.account_no || r.account || r["account_#"]);
    const qb = t(r.quickbooks_id || r.qb_id);
    const row: Record<string, string | null> = {
      name,
      account_no: acct,
      default_branch_id: branchFor(r.branch || r.default_branch || ""),
      contact_name: t(r.contact_name || r.contact),
      phone: t(r.phone),
      email: t(r.email),
      city: t(r.city),
      state: t(r.state),
      bill_address: t(r.bill_address || r.billing_address || r.bill_to),
      ship_address: t(r.ship_address || r.shipping_address || r.ship_to),
    };
    if (qb) { row.qb_id = qb; row.source = "quickbooks"; }
    if (!row.default_branch_id) delete row.default_branch_id; // keep a branch someone already chose
    const id = (qb && byQb.get(qb)) || (acct && byAcct.get(acct.toLowerCase())) || byName.get(name.toLowerCase());
    if (id === "new") { skipped++; continue; } // listed twice in the file
    if (id) {
      const { error } = await supabase.from("companies").update(row).eq("id", id);
      if (error) skipped++;
      else updated++;
    } else {
      toInsert.push({ ...row, source: row.source ?? "admin", default_branch_id: row.default_branch_id ?? null });
      if (qb) byQb.set(qb, "new");
      if (acct) byAcct.set(acct.toLowerCase(), "new");
      byName.set(name.toLowerCase(), "new");
    }
  }
  // New customers go in batches so a long QuickBooks list doesn't time out.
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error } = await supabase.from("companies").insert(chunk, { defaultToNull: false });
    if (!error) { added += chunk.length; continue; }
    for (const one of chunk) {
      const { error: e1 } = await supabase.from("companies").insert(one);
      if (e1) skipped++;
      else added++;
    }
  }
  revalidatePath("/admin/companies");
  return { ok: true, message: `${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}.` };
}

// ------------------------------------------------------------------ catalog
export async function saveCategory(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const name = s(form, "name");
  if (!name) return;
  const row = { name, customer_priced: form.get("customer_priced") === "on", sort: num(form.get("sort")) ?? 0 };
  if (id) await supabase.from("categories").update(row).eq("id", id);
  else await supabase.from("categories").insert({ id: slug(name), ...row });
  revalidatePath("/admin/products");
  revalidatePath("/order");
  revalidatePath("/");
}

export async function saveProduct(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const cp = s(form, "customer_priced");
  const row = {
    sku: s(form, "sku"),
    name: s(form, "name"),
    description: n(form, "description"),
    category_id: n(form, "category_id"),
    unit: s(form, "unit") || "each",
    list_price: num(form.get("list_price")),
    customer_priced: cp === "yes" ? true : cp === "no" ? false : null,
    active: id ? form.get("active") === "on" : true,
    sort: num(form.get("sort")) ?? 0,
    sqft_per_unit: num(form.get("sqft_per_unit")),
    sale_price: num(form.get("sale_price")),
    sale_ends: /^\d{4}-\d{2}-\d{2}$/.test(s(form, "sale_ends")) && num(form.get("sale_price")) !== null ? s(form, "sale_ends") : null,
  };
  if (!row.sku || !row.name) return;
  if (id) await supabase.from("products").update(row).eq("id", id);
  else await supabase.from("products").insert(row);
  revalidatePath("/admin/products");
  revalidatePath("/order");
}

export async function importProducts(rows: Record<string, string>[], hideMissing: boolean): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  const { products, problems } = normalizeProductRows(rows);
  if (products.length === 0) {
    return { ok: false, message: problems[0] ?? "No product rows found. The file needs a SKU column and a name (or Description) column." };
  }

  // Match categories by name or code; create any new ones.
  const { data: cats } = await supabase.from("categories").select("id, name, sort, customer_priced");
  const catByKey = new Map<string, { id: string; cp: boolean }>();
  for (const c of cats ?? []) {
    const v = { id: c.id, cp: c.customer_priced };
    catByKey.set(c.id.toLowerCase(), v);
    catByKey.set(c.name.toLowerCase(), v);
    catByKey.set(slug(c.name), v);
  }
  let nextSort = Math.max(0, ...(cats ?? []).map((c) => c.sort)) + 1;
  for (const p of products) {
    const name = p.categoryName;
    if (!name || catByKey.has(name.toLowerCase()) || catByKey.has(slug(name))) continue;
    const id = slug(name);
    const cp = CUSTOMER_PRICED_CATEGORIES.includes(name.toLowerCase());
    await supabase.from("categories").upsert({ id, name, customer_priced: cp, sort: nextSort++ }, { onConflict: "id", ignoreDuplicates: true });
    catByKey.set(name.toLowerCase(), { id, cp });
    catByKey.set(id, { id, cp });
  }

  let masked = 0;
  const payload = products.map((p) => {
    const cat = p.categoryName ? catByKey.get(p.categoryName.toLowerCase()) ?? catByKey.get(slug(p.categoryName)) : undefined;
    const cp = p.customer_priced ?? cat?.cp ?? false;
    // Customer-priced items never store a list price, so it can't leak to contractors.
    if (cp && p.list_price !== null) masked++;
    return {
      sku: p.sku,
      name: p.name,
      description: p.description,
      category_id: cat?.id ?? null,
      unit: p.unit,
      list_price: cp ? null : p.list_price,
      customer_priced: p.customer_priced,
      active: p.active,
      sort: p.sort,
    };
  });

  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from("products").upsert(payload.slice(i, i + 200), { onConflict: "sku" });
    if (error) return { ok: false, message: `Import stopped: ${error.message}` };
  }

  // Batts: fill in square feet per bag from the name ("... 240.25 S/F ...") so they can be ordered by square feet.
  // Only blanks are filled, so a number an admin typed in stays.
  const batts = payload
    .filter((p) => p.category_id === "fiberglass")
    .map((p) => ({ sku: p.sku, sqft: sqftFromName(p.name) }))
    .filter((b): b is { sku: string; sqft: number } => b.sqft !== null);
  for (let i = 0; i < batts.length; i += 10) {
    await Promise.all(
      batts.slice(i, i + 10).map((b) => supabase.from("products").update({ sqft_per_unit: b.sqft }).eq("sku", b.sku).is("sqft_per_unit", null)),
    );
  }

  let hidden = 0;
  if (hideMissing) {
    const { data: all } = await supabase.from("products").select("id, sku, active");
    const keep = new Set(payload.map((p) => p.sku.toLowerCase()));
    const toHide = (all ?? []).filter((p) => p.active && !keep.has(p.sku.toLowerCase())).map((p) => p.id);
    if (toHide.length) {
      await supabase.from("products").update({ active: false }).in("id", toHide);
      hidden = toHide.length;
    }
  }
  revalidatePath("/admin/products");
  revalidatePath("/order");
  const noPrice = payload.filter((p) => p.list_price === null && !(p.customer_priced ?? false) && !(catByKey.get(p.category_id ?? "")?.cp)).length;
  const parts = [
    `${payload.length} products imported`,
    hidden ? `${hidden} hidden` : "",
    noPrice ? `${noPrice} have no price yet (they show "Price confirmed on invoice")` : "",
    masked ? `${masked} customer-priced prices left out on purpose` : "",
  ].filter(Boolean);
  return {
    ok: true,
    message: `${parts.join(", ")}.${problems.length ? ` Skipped: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? "…" : ""}` : ""}`,
  };
}

// -------------------------------------------------------------------- links
export async function saveLink(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const row = {
    title: s(form, "title"),
    subtitle: n(form, "subtitle"),
    url: n(form, "url"),
    icon: s(form, "icon") || "link",
    section: s(form, "section") === "forms" ? "forms" : "resources",
    audience: ["all", "customer", "employee"].includes(s(form, "audience")) ? s(form, "audience") : "all",
    open_in_app: form.get("open_in_app") === "on",
    sort: num(form.get("sort")) ?? 0,
    active: id ? form.get("active") === "on" : true,
    perm: (PERM_KEYS as string[]).includes(s(form, "perm")) ? s(form, "perm") : null,
    folder: ["main", "sales", "forms", "learn", "admin"].includes(s(form, "folder")) ? s(form, "folder") : null,
  };
  if (!row.title) return;
  const write = (r: Partial<typeof row>) => (id ? supabase.from("links").update(r).eq("id", id) : supabase.from("links").insert(r));
  const { error } = await write(row);
  if (error && /perm|folder/i.test(error.message)) {
    // An update (0011 roles, 0026 folders) hasn't been run yet: save everything else.
    const { perm, folder: _skip, ...rest } = row;
    void _skip;
    const { error: again } = await write(/folder/i.test(error.message) ? { ...rest, perm } : rest);
    if (again && /perm/i.test(again.message)) await write(rest);
  }
  revalidatePath("/admin/links");
  revalidatePath("/");
}

export async function deleteLink(form: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("links").delete().eq("id", s(form, "id"));
  revalidatePath("/admin/links");
  revalidatePath("/");
}

// --------------------------------------------------------------------- docs
const MAX_DOC_BYTES = 50 * 1024 * 1024; // matches the docs bucket limit
type DocForCopy = Pick<DocumentRow, "id" | "title" | "doc_type" | "audience" | "url" | "storage_path">;
type Db = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

/** Downloads a document's link and keeps the file in the app's own storage. */
async function copyFromLink(supabase: Db, doc: DocForCopy): Promise<ImportResult> {
  if (!doc.url) return { ok: false, message: "There's no link to copy from." };
  let link: URL;
  try {
    link = new URL(doc.url);
  } catch {
    return { ok: false, message: "That link isn't a web address." };
  }
  if (link.protocol !== "https:" && link.protocol !== "http:") return { ok: false, message: "Only http(s) links can be copied." };

  let res: Response;
  try {
    res = await fetch(link, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AMBIT Intelligence docs copier)", Accept: "application/pdf,image/*,*/*;q=0.8" },
    });
  } catch {
    return { ok: false, message: "The website didn't answer. Try again in a minute." };
  }
  if (!res.ok) return { ok: false, message: `The website said ${res.status} (the file may have moved).` };
  const kind = fileKind(res.headers.get("content-type"), res.url || doc.url);
  if (!kind) return { ok: false, message: "That link isn't a PDF, image or Office file." };
  if (Number(res.headers.get("content-length") ?? 0) > MAX_DOC_BYTES) return { ok: false, message: "That file is over 50 MB." };
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_DOC_BYTES) return { ok: false, message: "That file is over 50 MB." };
  if (kind.ext === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return { ok: false, message: "The link didn't return a PDF (it may point to a web page)." };
  }

  const key = storageKeyFor(doc, kind.ext);
  const { error } = await supabase.storage.from("docs").upload(key, bytes, { contentType: kind.type, upsert: true });
  if (error) return { ok: false, message: `Couldn't store the file: ${error.message}` };
  const { error: upd } = await supabase.from("documents").update({ storage_path: key }).eq("id", doc.id);
  if (upd) return { ok: false, message: upd.message };
  if (doc.storage_path && doc.storage_path !== key) await supabase.storage.from("docs").remove([doc.storage_path]);
  const mb = bytes.byteLength / 1024 / 1024;
  return { ok: true, message: `Copied into the app (${mb < 0.1 ? "<0.1" : mb.toFixed(1)} MB).` };
}

/** Admin > Docs: copy one linked file into the app (the bulk button calls this once per document). */
export async function copyDocFile(id: string): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, doc_type, audience, url, storage_path")
    .eq("id", id)
    .maybeSingle<DocForCopy>();
  if (!doc) return { ok: false, message: "That document no longer exists." };
  const res = await copyFromLink(supabase, doc);
  revalidatePath("/admin/docs");
  revalidatePath("/docs");
  return res;
}

export async function saveDoc(form: FormData): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const products = parseProducts(s(form, "products"));
  const renewal = s(form, "renewal_on");
  const row = {
    title: s(form, "title"),
    doc_type: DOC_TYPES.some((t) => t.id === s(form, "doc_type")) ? s(form, "doc_type") : "Other",
    products,
    product: products[0] ?? null,
    category: n(form, "category"),
    code: n(form, "code"),
    description: n(form, "description"),
    revision: n(form, "revision"),
    renewal_on: /^\d{4}-\d{2}-\d{2}$/.test(renewal) ? renewal : null,
    url: n(form, "url"),
    storage_path: n(form, "storage_path"),
    audience: ["all", "customer", "employee"].includes(s(form, "audience")) ? s(form, "audience") : "all",
    sort: num(form.get("sort")) ?? 0,
    active: form.get("active") !== null ? form.get("active") === "on" : true,
  };
  if (!row.title) return { ok: false, message: "Give the document a title." };
  if (row.url && !/^https?:\/\//i.test(row.url)) return { ok: false, message: "The link should start with https://" };

  let before: DocForCopy | null = null;
  if (id) {
    const { data } = await supabase.from("documents").select("id, title, doc_type, audience, url, storage_path").eq("id", id).maybeSingle<DocForCopy>();
    before = data;
  }
  const saved = id
    ? await supabase.from("documents").update(row).eq("id", id).select("id, title, doc_type, audience, url, storage_path").single<DocForCopy>()
    : await supabase.from("documents").insert(row).select("id, title, doc_type, audience, url, storage_path").single<DocForCopy>();
  if (saved.error || !saved.data) return { ok: false, message: saved.error?.message ?? "Couldn't save." };

  // "Keep a copy in the app": copy when there's a link and no stored file yet, or the link changed.
  let note = "Saved.";
  const wantsCopy = form.get("keep_copy") === "on";
  const linkChanged = Boolean(before && before.url !== row.url);
  if (wantsCopy && row.url && (!row.storage_path || linkChanged)) {
    const copied = await copyFromLink(supabase, { ...saved.data, storage_path: row.storage_path });
    note = copied.ok ? `Saved. ${copied.message}` : `Saved, but the file wasn't copied: ${copied.message}`;
    // A new document is already saved at this point, so report it as added (with the warning)
    // rather than inviting a second click that would create a duplicate.
    if (!copied.ok && id) {
      revalidatePath("/admin/docs");
      revalidatePath("/docs");
      return { ok: false, message: note };
    }
  }
  revalidatePath("/admin/docs");
  revalidatePath("/docs");
  return { ok: true, message: note };
}

export async function deleteDoc(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const { data: doc } = await supabase.from("documents").select("storage_path").eq("id", id).maybeSingle();
  if (doc?.storage_path) await supabase.storage.from("docs").remove([doc.storage_path]);
  await supabase.from("documents").delete().eq("id", id);
  revalidatePath("/admin/docs");
  revalidatePath("/docs");
}

// ------------------------------------------------------------------ courses
export async function saveCourse(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const row = {
    title: s(form, "title"),
    subtitle: n(form, "subtitle"),
    lessons: num(form.get("lessons")),
    minutes: num(form.get("minutes")),
    status: s(form, "status") === "live" ? "live" : "coming_soon",
    url: n(form, "url"),
    audience: ["all", "customer", "employee"].includes(s(form, "audience")) ? s(form, "audience") : "all",
    sort: num(form.get("sort")) ?? 0,
  };
  if (!row.title) return;
  if (id) await supabase.from("courses").update(row).eq("id", id);
  else await supabase.from("courses").insert(row);
  revalidatePath("/admin/academy");
  revalidatePath("/academy");
}

// ----------------------------------------------------------------- branches
export async function saveBranch(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const row = {
    name: s(form, "name"),
    state: s(form, "state").toUpperCase().slice(0, 2),
    address: n(form, "address"),
    phone: n(form, "phone"),
    email: n(form, "email"),
    sort: num(form.get("sort")) ?? 0,
    active: form.get("active") === "on",
  };
  if (!id || !row.name) return;
  await supabase.from("branches").update(row).eq("id", id);
  revalidatePath("/admin/branches");
  revalidatePath("/branches");
}

// ------------------------------------------------------------ product photos
export async function setProductImages(list: { sku: string; url: string | null }[]): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  const clean = list
    .filter((x) => x && typeof x.sku === "string" && x.sku.trim())
    .map((x) => ({ sku: x.sku.trim(), url: x.url && /^https?:\/\//.test(x.url) ? x.url : null }));
  if (clean.length === 0) return { ok: false, message: "No photos to save." };
  const { data, error } = await supabase.rpc("admin_set_product_images", { p: clean });
  if (error) {
    if (/function .* does not exist|Could not find the function/i.test(error.message)) {
      return { ok: false, message: "Photos need database update 0006. Run update-0006-product-images.sql in Supabase, then try again." };
    }
    return { ok: false, message: error.message };
  }
  revalidatePath("/admin/products");
  revalidatePath("/order");
  return { ok: true, message: `${data ?? 0} product photo${data === 1 ? "" : "s"} saved.` };
}
