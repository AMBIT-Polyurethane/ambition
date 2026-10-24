"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { PROMO_THEMES } from "@/lib/promo-themes";

// Admin → Home banner: add, change, move and remove the slides at the top of Home.

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => s(f, k) || null;
const day = (f: FormData, k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s(f, k)) ? s(f, k) : null);
const money = (v: string): number | null => {
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : NaN;
};
const back = (q: string): never => redirect(`/admin/promos?${q}`);
const done = (msg: string, id?: string) => {
  revalidatePath("/admin/promos");
  revalidatePath("/");
  revalidatePath("/order");
  back(`msg=${encodeURIComponent(msg)}${id ? `#p-${id}` : ""}`);
};

/** Image addresses: our own files, or https links. */
function cleanImage(v: string): string | null {
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return /^https:\/\//i.test(v) ? v : null;
}

/** Links: a page in the app ("/docs") or a web address. */
function cleanLink(v: string): string | null {
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) return `https://${v}`;
  return null;
}

export async function savePromo(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = n(form, "id");
  const kind = (["product", "locations", "custom"].includes(s(form, "kind")) ? s(form, "kind") : "product") as "product" | "locations" | "custom";
  const theme = PROMO_THEMES[s(form, "theme")] ? s(form, "theme") : "blue";
  const audience = ["all", "employee", "customer"].includes(s(form, "audience")) ? s(form, "audience") : "all";
  const rawLink = s(form, "link");
  const link = cleanLink(rawLink);
  if (rawLink && !link) back("err=" + encodeURIComponent("The link should be a page in the app (like /docs) or a web address."));

  let productId: string | null = null;
  if (kind === "product") {
    const sku = s(form, "sku");
    if (!sku) back("err=" + encodeURIComponent("Pick the product for this slide (type its SKU or name)."));
    // The box shows "SKU · name"; the SKU is the part before the dot.
    const code = sku.split(" · ")[0].trim();
    const { data: p } = await supabase.from("products").select("id").eq("sku", code).maybeSingle();
    if (!p) back("err=" + encodeURIComponent(`No product with SKU ${code}. Check Admin → Products.`));
    productId = p!.id as string;

    // The sale price lives on the product, so Order charges the same price the banner shows.
    const sale = money(s(form, "sale_price"));
    if (Number.isNaN(sale)) back("err=" + encodeURIComponent("The sale price should be a number, like 33.50."));
    const { error: perr } = await supabase
      .from("products")
      .update({ sale_price: sale, sale_ends: sale === null ? null : day(form, "sale_ends") })
      .eq("id", productId);
    if (perr) back("err=" + encodeURIComponent(perr.message));
  }

  const title = s(form, "title");
  if (!title && kind !== "product") back("err=" + encodeURIComponent("Give the slide a title."));

  const row = {
    kind,
    product_id: productId,
    eyebrow: n(form, "eyebrow"),
    title: title || "",
    subtitle: n(form, "subtitle"),
    image_url: cleanImage(s(form, "image_url")),
    link,
    theme,
    audience,
    active: form.get("active") === "on",
    starts_on: day(form, "starts_on"),
    ends_on: day(form, "ends_on"),
  };

  if (id) {
    const { error } = await supabase.from("promos").update(row).eq("id", id);
    if (error) back("err=" + encodeURIComponent(error.message));
    done("Slide saved.", id);
  } else {
    const { data: last } = await supabase.from("promos").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase
      .from("promos")
      .insert({ ...row, sort: ((last?.sort as number | undefined) ?? 0) + 1 })
      .select("id")
      .single();
    if (error) back("err=" + encodeURIComponent(error.message));
    done("Slide added. It shows last in the banner; use the arrows to move it.", data?.id as string);
  }
}

export async function movePromo(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const dir = s(form, "dir") === "up" ? -1 : 1;
  const { data } = await supabase.from("promos").select("id, sort").order("sort").order("created_at");
  const list = (data ?? []) as { id: string; sort: number }[];
  const i = list.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) back("");
  [list[i], list[j]] = [list[j], list[i]];
  // Renumber everything so the order is always clean.
  await Promise.all(list.map((r, k) => supabase.from("promos").update({ sort: k + 1 }).eq("id", r.id)));
  done("Order changed.", id);
}

export async function showPromo(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  const on = s(form, "on") === "1";
  await supabase.from("promos").update({ active: on }).eq("id", id);
  done(on ? "Slide is showing on Home." : "Slide hidden. It stays here so you can show it again.", id);
}

export async function deletePromo(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = s(form, "id");
  await supabase.from("promos").delete().eq("id", id);
  done("Slide deleted.");
}
