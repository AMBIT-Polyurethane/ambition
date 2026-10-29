"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/ops/server";
import { opsCan, OPS_ROLE_KEYS } from "@/lib/ops/roles";
import { CLOSED, LABOR_METHODS, type LaborRate, type Stage, type WorkArea } from "@/lib/ops/defaults";
import { ambitPrices } from "@/lib/ops/seed";
import { currentOrigin } from "@/lib/origin";
import { newToken, type InviteResult } from "@/lib/invites";
import { sendOpsInvite } from "@/lib/ops/invite";
import { dateShort, orderNo } from "@/lib/format";

// AMBIT-OPS settings (owner and office). Saved with the person's own login; the database checks the role.

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const go = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}?${kind}=${encodeURIComponent(text)}`);
const numOrNull = (v: string, max = 1e9) => {
  const t = v.replace(/[$,%\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : NaN;
};

async function save(patch: Record<string, unknown>, back: string, ok: string) {
  const { supabase } = await requireOps(opsCan.manage);
  const { error } = await supabase.rpc("ops_save_settings", { p_patch: patch });
  if (error) go(back, "err", error.message);
  revalidatePath("/ops", "layout");
  go(back, "msg", ok);
}

/** Mark a setup step as looked at (Home's checklist). */
async function reviewed(key: string) {
  const { supabase, ws } = await requireOps(opsCan.manage);
  const cur = ((ws.company.ops_settings ?? {}) as Record<string, unknown>).reviewed as Record<string, boolean> | undefined;
  await supabase.rpc("ops_save_settings", { p_patch: { reviewed: { ...(cur ?? {}), [key]: true } } });
}

// ------------------------------------------------------------------ company
export async function saveCompany(f: FormData) {
  const color = s(f, "color");
  await save(
    {
      display_name: s(f, "display_name").slice(0, 120),
      phone: s(f, "phone").slice(0, 40),
      email: s(f, "email").slice(0, 160).toLowerCase(),
      website: s(f, "website").slice(0, 200),
      address: s(f, "address").slice(0, 300),
      license_no: s(f, "license_no").slice(0, 80),
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : "",
    },
    "/ops/settings/company",
    "Company info saved.",
  );
}

export async function setLogo(path: string | null): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireOps(opsCan.manage);
  const { error } = await supabase.rpc("ops_set_logo", { p_path: path });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/ops", "layout");
  return { ok: true };
}

// ------------------------------------------------------------------ pricing, defaults and labor
export async function savePricing(f: FormData) {
  const back = "/ops/settings/pricing";
  const fields = { target_margin: 99, floor_margin: 99, burden_pct: 200, waste_pct: 100, deposit_pct: 100, min_job: 1e7, tax_rate: 30 } as const;
  const patch: Record<string, unknown> = {};
  for (const [k, max] of Object.entries(fields)) {
    const v = numOrNull(s(f, k), max);
    if (Number.isNaN(v)) go(back, "err", `Check the number for ${k.replace(/_/g, " ")}.`);
    patch[k] = k === "waste_pct" ? v ?? 10 : v;
  }
  if (patch.target_margin !== null && patch.floor_margin !== null && (patch.floor_margin as number) > (patch.target_margin as number)) {
    go(back, "err", "The lowest margin can't be higher than the target.");
  }
  const days = Number(s(f, "quote_days"));
  patch.quote_days = Number.isFinite(days) && days >= 1 && days <= 365 ? Math.round(days) : 30;
  patch.followup_days = s(f, "followup_days")
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 90)
    .slice(0, 6);
  patch.tax_labor = f.get("tax_labor") === "on";
  patch.show_line_prices = f.get("show_line_prices") === "on";
  const unit = s(f, "measure_unit");
  patch.measure_unit = ["lbs", "gallons", "strokes"].includes(unit) ? unit : "lbs";
  // Labor rates: one row per kind of work.
  const keys = f.getAll("labor_key").map(String);
  const labor: LaborRate[] = [];
  keys.forEach((key, i) => {
    const name = String(f.getAll("labor_name")[i] ?? "").trim().slice(0, 60) || key;
    const method = String(f.getAll("labor_method")[i] ?? "per_sqft");
    const rate = numOrNull(String(f.getAll("labor_rate")[i] ?? ""), 100000);
    if (Number.isNaN(rate)) go(back, "err", `Check the labor rate for ${name}.`);
    labor.push({ key, name, method: (LABOR_METHODS.some((m) => m.key === method) ? method : "per_sqft") as LaborRate["method"], rate: rate as number | null });
  });
  patch.labor = labor;
  const { supabase, ws } = await requireOps(opsCan.manage);
  const cur = ((ws.company.ops_settings ?? {}) as Record<string, unknown>).reviewed as Record<string, boolean> | undefined;
  patch.reviewed = { ...(cur ?? {}), labor: true };
  const { error } = await supabase.rpc("ops_save_settings", { p_patch: patch });
  if (error) go(back, "err", error.message);
  revalidatePath("/ops", "layout");
  go(back, "msg", "Pricing and labor saved.");
}

// ------------------------------------------------------------------ pipeline and lists
export async function savePipeline(f: FormData) {
  const back = "/ops/settings/pipeline";
  const { supabase, ws } = await requireOps(opsCan.manage);
  const keys = f.getAll("stage_key").map(String);
  const names = f.getAll("stage_name").map((x) => String(x).trim().slice(0, 40));
  const stages: Stage[] = [];
  const used = new Set<string>();
  keys.forEach((k, i) => {
    if (!names[i] || CLOSED.includes(k)) return;
    let key = k && !used.has(k) ? k : names[i].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || `stage_${i}`;
    while (used.has(key) || CLOSED.includes(key)) key = `${key}_2`;
    used.add(key);
    stages.push({ key, name: names[i] });
  });
  if (!stages.length) go(back, "err", "Keep at least one open stage.");
  // A stage that still has leads can't disappear.
  const gone = ws.settings.stages.filter((x) => !CLOSED.includes(x.key) && !stages.some((y) => y.key === x.key));
  if (gone.length) {
    const { count } = await supabase.from("ops_leads").select("id", { count: "exact", head: true }).eq("company_id", ws.company.id).in("stage", gone.map((g) => g.key));
    if ((count ?? 0) > 0) go(back, "err", `Move the leads out of ${gone.map((g) => g.name).join(", ")} before removing ${gone.length === 1 ? "it" : "them"}.`);
  }
  const won = ws.settings.stages.find((x) => x.key === "won")!;
  const lost = ws.settings.stages.find((x) => x.key === "lost")!;
  const wonName = s(f, "won_name").slice(0, 40) || won.name;
  const lostName = s(f, "lost_name").slice(0, 40) || lost.name;
  const lines = (k: string, max = 40) =>
    [...new Set(s(f, k).split(/\n/).map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, max);
  const areas: WorkArea[] = [];
  f.getAll("area_code").forEach((c, i) => {
    const code = String(c).trim().toUpperCase().slice(0, 4);
    const name = String(f.getAll("area_name")[i] ?? "").trim().slice(0, 40);
    if (code && name && !areas.some((a) => a.code === code)) areas.push({ code, name });
  });
  const patch = {
    stages: [...stages, { key: "won", name: wonName }, { key: "lost", name: lostName }],
    sources: lines("sources"),
    lost_reasons: lines("lost_reasons", 20),
    services: lines("services", 20),
    work_areas: areas,
  };
  if (!patch.lost_reasons.length) go(back, "err", "Keep at least one reason a lead is lost.");
  const { error } = await supabase.rpc("ops_save_settings", { p_patch: patch });
  if (error) go(back, "err", error.message);
  revalidatePath("/ops", "layout");
  go(back, "msg", "Pipeline and lists saved.");
}

// ------------------------------------------------------------------ products
export async function saveProduct(f: FormData) {
  const back = "/ops/settings/products";
  const { supabase, ws } = await requireOps(opsCan.manage);
  const id = s(f, "id");
  const { data: cur } = id ? await supabase.from("ops_products").select("id, kind, cost_source, yield_bf").eq("id", id).maybeSingle() : { data: null };
  const num = (k: string, max = 1e7) => {
    const v = numOrNull(s(f, k), max);
    if (Number.isNaN(v)) go(back, "err", `Check the number for ${k.replace(/_/g, " ")}.`);
    return v as number | null;
  };
  const row: Record<string, unknown> = {
    name: s(f, "name").slice(0, 120) || "Product",
    waste_pct: num("waste_pct", 100) ?? 10,
    active: f.get("active") === "on",
  };
  if (s(f, "yield_bf") !== "") row.yield_bf = num("yield_bf", 100000);
  if (s(f, "lb_per_set") !== "") row.lb_per_set = num("lb_per_set", 10000);
  if (s(f, "sqft_per_unit") !== "") row.sqft_per_unit = num("sqft_per_unit", 100000);
  if (s(f, "r_value") !== "") row.r_value = num("r_value", 100);
  // AMBIT products cost what the contractor's AMBIT invoices say; other brands are typed in.
  if (!cur || cur.cost_source !== "ambit") {
    row.cost = num("cost");
    row.cost_source = "manual";
    row.cost_note = row.cost === null ? null : "Entered by you";
  }
  if (!id) {
    const kind = s(f, "kind");
    Object.assign(row, { company_id: ws.company.id, kind: kind || "other", unit: s(f, "unit").slice(0, 12) || "each", price_unit: s(f, "price_unit") || null, sku: s(f, "sku").slice(0, 40) || null });
  }
  const { error } = id ? await supabase.from("ops_products").update(row).eq("id", id) : await supabase.from("ops_products").insert(row);
  if (error) go(back, "err", error.message);
  revalidatePath(back);
  go(back, "msg", id ? "Product saved." : "Product added.");
}

export async function markProductsReviewed() {
  await reviewed("products");
  revalidatePath("/ops");
  go("/ops/settings/products", "msg", "Marked as checked. You can change any of these later.");
}

/** Add an item from AMBIT's catalog (disposable supplies, coatings, fiberglass…) to their library. */
export async function addFromCatalog(f: FormData) {
  const back = "/ops/settings/products";
  const { supabase, ws } = await requireOps(opsCan.manage);
  const pid = s(f, "product_id");
  const { data: p } = await supabase.from("products").select("id, sku, name, unit, category_id, sqft_per_unit, list_price, categories(ops_quotable)").eq("id", pid).maybeSingle();
  if (!p) go(back, "err", "That AMBIT product isn't in the catalog anymore.");
  const cat = (p as unknown as { categories: { ops_quotable: boolean } | null }).categories;
  if (cat && !cat.ops_quotable) go(back, "err", "Gun parts and tools can't go on quotes.");
  const prices = await ambitPrices(supabase, ws.company.id);
  const last = prices.sku[String(p!.sku).trim().toUpperCase()];
  const cost = last ? last.price : p!.list_price === null ? null : Number(p!.list_price);
  const kind = p!.category_id === "fiberglass" ? (/jet ?stream|climate ?pro|blow|loose/i.test(String(p!.name)) ? "blown" : "batt") : /intumescent/.test(String(p!.category_id)) ? "intumescent" : /roof/.test(String(p!.category_id)) ? "coating" : "supply";
  const { error } = await supabase.from("ops_products").insert({
    company_id: ws.company.id,
    product_id: p!.id,
    ambit_skus: [p!.sku],
    kind,
    name: p!.name,
    sku: p!.sku,
    unit: p!.unit || "each",
    cost,
    cost_source: last ? "ambit" : "manual",
    cost_note: last ? `From your AMBIT invoice on ${orderNo(last.order)} (${dateShort(last.on)})` : cost !== null ? "AMBIT list price" : null,
    sqft_per_unit: p!.sqft_per_unit,
    waste_pct: 10,
    price_unit: kind === "supply" ? "each" : "sqft",
  });
  if (error) go(back, "err", error.message);
  revalidatePath(back);
  go(back, "msg", `${p!.name} added.`);
}

/** Pull the latest prices from their AMBIT invoices into every AMBIT product. */
export async function refreshAmbitCosts() {
  const back = "/ops/settings/products";
  const { supabase, ws } = await requireOps(opsCan.manage);
  const [{ data: items }, prices] = await Promise.all([
    supabase.from("ops_products").select("id, kind, sku, ambit_skus").eq("company_id", ws.company.id).not("product_id", "is", null),
    ambitPrices(supabase, ws.company.id),
  ]);
  let n = 0;
  for (const it of (items ?? []) as { id: string; kind: string; sku: string | null; ambit_skus: string[] }[]) {
    const k = (it.sku ?? "").trim().toUpperCase();
    const isFoam = it.kind.startsWith("foam");
    const resin = prices.sku[k];
    const iso = isFoam ? prices.iso[k] : null;
    if (isFoam ? !(resin && iso) : !resin) continue;
    const cost = isFoam ? Math.round((resin!.price + iso!.price) * 100) / 100 : resin!.price;
    const newer = isFoam && Date.parse(iso!.on) > Date.parse(resin!.on) ? iso! : resin!;
    await supabase.from("ops_products").update({ cost, cost_source: "ambit", cost_note: `From your AMBIT invoice on ${orderNo(newer.order)} (${dateShort(newer.on)})` }).eq("id", it.id);
    n++;
  }
  revalidatePath(back);
  go(back, "msg", n ? `Updated ${n} cost${n === 1 ? "" : "s"} from your latest AMBIT invoices.` : "No newer AMBIT invoice prices found.");
}

// ------------------------------------------------------------------ team
export async function inviteMember(_prev: InviteResult, f: FormData): Promise<InviteResult> {
  const { supabase, profile, ws } = await requireOps(opsCan.manage);
  const email = s(f, "email").toLowerCase();
  const name = s(f, "full_name") || null;
  const phone = s(f, "phone") || null;
  const role = s(f, "role");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Type their email address." };
  if (!OPS_ROLE_KEYS.includes(role as never)) return { ok: false, error: "Pick their role." };
  const { token, hash } = newToken();
  const { data: invId, error } = await supabase.rpc("ops_invite", { p_email: email, p_name: name, p_phone: phone, p_role: role, p_location: s(f, "location_id") || null, p_hash: hash });
  if (error) return { ok: false, error: error.message };
  const origin = await currentOrigin();
  const by = profile.full_name || profile.email;
  const existing = !invId;
  const link = existing ? `${origin}/signin` : `${origin}/join/${token}`;
  const res = await sendOpsInvite({ email, name, role, company: ws.brand, by, link, existing });
  if (invId) await supabase.rpc("ops_invite_sent", { p_invite: invId, p_status: res.status });
  revalidatePath("/ops/settings/team");
  return { ok: true, email, name, phone, existing, link, emailStatus: res.status, emailError: res.error, subject: res.subject, text: res.text };
}

export async function setMember(f: FormData) {
  const back = "/ops/settings/team";
  const { supabase } = await requireOps(opsCan.manage);
  const role = s(f, "role");
  const { error } = await supabase.rpc("ops_set_member", { p_user: s(f, "id"), p_role: role === "remove" ? null : role, p_location: s(f, "location_id") || null });
  if (error) go(back, "err", error.message);
  revalidatePath(back);
  go(back, "msg", role === "remove" ? "Taken off the team." : "Saved.");
}

export async function cancelInvite(f: FormData) {
  const { supabase } = await requireOps(opsCan.manage);
  await supabase.rpc("ops_cancel_invite", { p_invite: s(f, "id") });
  revalidatePath("/ops/settings/team");
  go("/ops/settings/team", "msg", "Invite cancelled.");
}

// ------------------------------------------------------------------ locations
export async function saveLocation(f: FormData) {
  const back = "/ops/settings/locations";
  const { supabase, ws } = await requireOps(opsCan.manage);
  const id = s(f, "id");
  const row = { name: s(f, "name").slice(0, 60), address: s(f, "address").slice(0, 300) || null, phone: s(f, "phone").slice(0, 40) || null };
  if (!row.name) go(back, "err", "Name the location.");
  const { error } = id ? await supabase.from("ops_locations").update(row).eq("id", id) : await supabase.from("ops_locations").insert({ ...row, company_id: ws.company.id });
  if (error) go(back, "err", error.message);
  revalidatePath(back);
  go(back, "msg", id ? "Location saved." : "Location added.");
}

export async function deleteLocation(f: FormData) {
  const back = "/ops/settings/locations";
  const { supabase, ws } = await requireOps(opsCan.manage);
  const { count } = await supabase.from("ops_locations").select("id", { count: "exact", head: true }).eq("company_id", ws.company.id);
  if ((count ?? 0) <= 1) go(back, "err", "Keep at least one location.");
  const { error } = await supabase.from("ops_locations").delete().eq("id", s(f, "id"));
  if (error) go(back, "err", error.message);
  revalidatePath(back);
  go(back, "msg", "Location removed.");
}

// ------------------------------------------------------------------ lead form and AMBIT support
export async function newFormLink() {
  const { supabase } = await requireOps(opsCan.manage);
  const { error } = await supabase.rpc("ops_new_form_link");
  if (error) go("/ops/settings/lead-form", "err", error.message);
  revalidatePath("/ops/settings/lead-form");
  go("/ops/settings/lead-form", "msg", "New link made. The old link stops working, so update your website.");
}

export async function markFormShared() {
  await reviewed("form");
  revalidatePath("/ops");
  go("/ops/settings/lead-form", "msg", "Done. New requests will show up under Leads.");
}

export async function setSupport(f: FormData) {
  const { supabase } = await requireOps((r) => r === "owner");
  const days = Number(s(f, "days"));
  const { error } = await supabase.rpc("ops_set_support", { p_days: Number.isFinite(days) ? days : 0 });
  if (error) go("/ops/settings/support", "err", error.message);
  revalidatePath("/ops/settings/support");
  go("/ops/settings/support", "msg", days > 0 ? `AMBIT can help in your workspace for the next ${days} days.` : "AMBIT can no longer open your workspace.");
}
