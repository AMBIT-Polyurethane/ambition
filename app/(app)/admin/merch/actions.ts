"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";

// Admin → Merch: shirts, hats and the rest on the ADC store (shown as Coming soon).

export type MerchInput = { id: string | null; name: string; description: string; price: string; sizes: string; image_url: string | null };
export type MerchResult = { ok: true; id: string } | { ok: false; error: string };

const refresh = () => {
  revalidatePath("/admin/merch");
  revalidatePath("/adc/merch");
};

function cleanImage(v: string | null): string | null {
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return /^https:\/\//i.test(v) ? v.slice(0, 600) : null;
}

export async function saveMerch(input: MerchInput): Promise<MerchResult> {
  const { supabase } = await requireAdmin();
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) return { ok: false, error: "Give it a name, like AMBIT Hoodie." };
  const raw = input.price.replace(/[$,\s]/g, "");
  const price = raw ? Number(raw) : null;
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) return { ok: false, error: "Price should be a number, like 29.99" };
  const row = {
    name,
    description: input.description.trim().slice(0, 1000) || null,
    price: price === null ? null : Math.round(price * 100) / 100,
    sizes: input.sizes.trim().slice(0, 200) || null,
    image_url: cleanImage(input.image_url),
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await supabase.from("merch_items").update(row).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, id: input.id };
  }
  const { data: last } = await supabase.from("merch_items").select("sort").order("sort", { ascending: false }).limit(1);
  const sort = (((last ?? []) as { sort: number }[])[0]?.sort ?? 0) + 10;
  const { data, error } = await supabase.from("merch_items").insert({ ...row, sort }).select("id").single();
  if (error) return { ok: false, error: /merch_items/.test(error.message) ? "Merch needs database update 0097 first." : error.message };
  refresh();
  return { ok: true, id: (data as { id: string }).id };
}

export async function showMerch(f: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(f.get("id") ?? "");
  if (!id) return;
  await supabase.from("merch_items").update({ active: f.get("on") === "1", updated_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function moveMerch(f: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(f.get("id") ?? "");
  const dir = f.get("dir") === "up" ? -1 : 1;
  const { data } = await supabase.from("merch_items").select("id, sort").order("sort").order("created_at");
  const rows = (data ?? []) as { id: string; sort: number }[];
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await Promise.all(rows.map((r, k) => supabase.from("merch_items").update({ sort: (k + 1) * 10 }).eq("id", r.id)));
  refresh();
}

export async function deleteMerch(f: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(f.get("id") ?? "");
  if (!id) return;
  await supabase.from("merch_items").delete().eq("id", id);
  refresh();
}
