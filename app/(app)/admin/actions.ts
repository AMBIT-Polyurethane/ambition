"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { sendEmail, wrapEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { escapeHtml as h, firstName } from "@/lib/format";
import type { Profile } from "@/lib/types";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => (s(f, k) === "" ? null : s(f, k));
const num = (v: unknown): number | null => {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  if (t === "") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};
const yes = (v: unknown) => /^(y|yes|true|1|x|on)$/i.test(String(v ?? "").trim());
const slug = (t: string) => t.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export type ImportResult = { ok: boolean; message: string };

// ------------------------------------------------------------------ accounts
export async function saveUser(form: FormData) {
  const { supabase } = await requireAdmin();
  const userId = s(form, "user_id");
  const role = s(form, "role") as Profile["role"];
  const status = s(form, "status") as Profile["status"];
  let companyId: string | null = n(form, "company_id");
  const branchId = n(form, "branch_id");

  const { data: before } = await supabase.from("profiles").select("*").eq("id", userId).single<Profile>();
  if (!before) return;

  if (companyId === "__new") {
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

  await supabase.rpc("admin_update_user", {
    p_user: userId,
    p_role: role,
    p_status: status,
    p_company: role === "customer" ? companyId : null,
    p_branch: branchId,
  });

  if (before.status !== "active" && status === "active") {
    const origin = await currentOrigin();
    await sendEmail({
      to: [before.email],
      subject: "You're approved for AMBITION",
      html: wrapEmail(
        "Welcome",
        `<div style="font-size:22px;font-weight:800;margin-bottom:10px;">You're in, ${h(firstName(before.full_name, before.email))}.</div>
<p style="font-size:15px;line-height:1.5;margin:0 0 18px;">Your AMBITION account is approved. You can now place orders, find product docs and bulletins, and take AMBIT Academy courses.</p>
<p style="margin:0;"><a href="${h(origin)}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;padding:12px 18px;border-radius:8px;">OPEN AMBITION</a></p>
<p style="font-size:13px;color:#52525b;margin:18px 0 0;">Tip: on your phone, open the link and choose "Add to Home Screen" to use it like an app.</p>`,
      ),
      text: `Your AMBITION account is approved. Open ${origin}`,
    }).catch(() => null);
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

// ----------------------------------------------------------------- companies
export async function saveCompany(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const row = {
    name: s(form, "name"),
    account_no: n(form, "account_no"),
    default_branch_id: n(form, "default_branch_id"),
    phone: n(form, "phone"),
    email: n(form, "email"),
    city: n(form, "city"),
    state: n(form, "state"),
    notes: n(form, "notes"),
    active: id ? form.get("active") === "on" : true,
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
  const { data: existing } = await supabase.from("companies").select("id, name, account_no");
  const byAcct = new Map((existing ?? []).filter((c) => c.account_no).map((c) => [String(c.account_no).toLowerCase(), c.id]));
  const byName = new Map((existing ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const name = (r.name || r.company || r.customer || "").trim();
    if (!name) { skipped++; continue; }
    const acct = (r.account_no || r.account || r["account_#"] || "").trim() || null;
    const row = {
      name,
      account_no: acct,
      default_branch_id: branchFor(r.branch || r.default_branch || ""),
      phone: (r.phone || "").trim() || null,
      email: (r.email || "").trim() || null,
      city: (r.city || "").trim() || null,
      state: (r.state || "").trim() || null,
    };
    const id = (acct && byAcct.get(acct.toLowerCase())) || byName.get(name.toLowerCase());
    const { error } = id ? await supabase.from("companies").update(row).eq("id", id) : await supabase.from("companies").insert(row);
    if (error) skipped++;
    else if (id) updated++;
    else added++;
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
  };
  if (!row.sku || !row.name) return;
  if (id) await supabase.from("products").update(row).eq("id", id);
  else await supabase.from("products").insert(row);
  revalidatePath("/admin/products");
  revalidatePath("/order");
}

export async function importProducts(rows: Record<string, string>[], hideMissing: boolean): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  const { data: cats } = await supabase.from("categories").select("id, name, sort");
  const catByKey = new Map<string, string>();
  for (const c of cats ?? []) {
    catByKey.set(c.id.toLowerCase(), c.id);
    catByKey.set(c.name.toLowerCase(), c.id);
  }
  let nextSort = Math.max(0, ...(cats ?? []).map((c) => c.sort)) + 1;

  const products: Record<string, unknown>[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sku = (r.sku || r.item || r["item_#"] || r["part_#"] || "").trim();
    const name = (r.name || r.description_short || r.product || "").trim();
    if (!sku && !name) continue;
    if (!sku || !name) { problems.push(`row ${i + 2}: needs both sku and name`); continue; }
    if (seen.has(sku.toLowerCase())) { problems.push(`row ${i + 2}: duplicate sku ${sku}`); continue; }
    seen.add(sku.toLowerCase());

    let category_id: string | null = null;
    const catName = (r.category || "").trim();
    if (catName) {
      category_id = catByKey.get(catName.toLowerCase()) ?? null;
      if (!category_id) {
        const id = slug(catName);
        const cp = /foam|fiberglass|fibreglass/i.test(catName);
        await supabase.from("categories").upsert({ id, name: catName, customer_priced: cp, sort: nextSort++ }, { onConflict: "id", ignoreDuplicates: true });
        catByKey.set(catName.toLowerCase(), id);
        catByKey.set(id, id);
        category_id = id;
      }
    }
    const cpRaw = (r.customer_priced || r.customer_pricing || "").trim();
    const activeRaw = (r.active || "").trim();
    products.push({
      sku,
      name,
      description: (r.description || r.detail || "").trim() || null,
      category_id,
      unit: (r.unit || r.uom || "each").trim() || "each",
      list_price: num(r.list_price ?? r.price ?? r.list),
      customer_priced: cpRaw ? yes(cpRaw) : null,
      active: activeRaw ? yes(activeRaw) : true,
      sort: num(r.sort) ?? i + 1,
    });
  }
  if (products.length === 0) return { ok: false, message: problems[0] ?? "No product rows found. Check the column names match the template." };

  for (let i = 0; i < products.length; i += 200) {
    const { error } = await supabase.from("products").upsert(products.slice(i, i + 200), { onConflict: "sku" });
    if (error) return { ok: false, message: `Import stopped: ${error.message}` };
  }

  let hidden = 0;
  if (hideMissing) {
    const { data: all } = await supabase.from("products").select("id, sku, active");
    const keep = new Set(products.map((p) => String(p.sku).toLowerCase()));
    const toHide = (all ?? []).filter((p) => p.active && !keep.has(p.sku.toLowerCase())).map((p) => p.id);
    if (toHide.length) {
      await supabase.from("products").update({ active: false }).in("id", toHide);
      hidden = toHide.length;
    }
  }
  revalidatePath("/admin/products");
  revalidatePath("/order");
  return {
    ok: true,
    message: `${products.length} products imported${hidden ? `, ${hidden} hidden` : ""}.${problems.length ? ` Skipped: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? "…" : ""}` : ""}`,
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
  };
  if (!row.title) return;
  if (id) await supabase.from("links").update(row).eq("id", id);
  else await supabase.from("links").insert(row);
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
export async function saveDoc(form: FormData): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const row = {
    title: s(form, "title"),
    doc_type: s(form, "doc_type") || "Other",
    product: n(form, "product"),
    code: n(form, "code"),
    description: n(form, "description"),
    url: n(form, "url"),
    storage_path: n(form, "storage_path"),
    audience: ["all", "customer", "employee"].includes(s(form, "audience")) ? s(form, "audience") : "all",
    published_on: n(form, "published_on"),
    sort: num(form.get("sort")) ?? 0,
    active: form.get("active") !== null ? form.get("active") === "on" : true,
  };
  if (!row.title) return { ok: false, message: "Give the document a title." };
  const { error } = id ? await supabase.from("documents").update(row).eq("id", id) : await supabase.from("documents").insert(row);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/docs");
  revalidatePath("/docs");
  return { ok: true, message: "Saved." };
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
