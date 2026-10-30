"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";

// AMBIT-OPS stock changes (the office and dispatch). The database checks the role and writes every
// change in the stock log with who did it.

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData) => {
  const b = s(f, "back");
  return b.startsWith("/ops/stock") ? b : "/ops/stock";
};
const go = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
const qtyOf = (v: string) => {
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const place = (v: string) => {
  const [kind, id] = v.split(":");
  return (kind === "location" || kind === "rig") && /^[0-9a-f-]{36}$/i.test(id ?? "") ? { kind, id } : null;
};

export async function addStock(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const to = place(s(f, "place"));
  const qty = qtyOf(s(f, "qty"));
  let item: Record<string, unknown> = {};
  try {
    item = JSON.parse(s(f, "item") || "{}");
  } catch {
    item = {};
  }
  if (!to) go(back(f), "err", "Pick the shop or rig.");
  if (!item.item_key) go(back(f), "err", "Pick what it is.");
  if (!(qty > 0)) go(back(f), "err", "Type how many (half a drum is 0.5).");
  const maker = item.foam === "iso" ? s(f, "maker") : "";
  const { error } = await supabase.rpc("ops_stock_add", {
    p_kind: to!.kind,
    p_place: to!.id,
    p_item: { item_key: item.item_key, product_id: item.product_id ?? null, ops_product_id: item.ops_product_id ?? null, name: item.name, unit: item.unit },
    p_maker: maker === "Other" ? "" : maker,
    p_lot: s(f, "lot").slice(0, 60),
    p_qty: qty,
    p_note: s(f, "note").slice(0, 200) || null,
  });
  if (error) go(back(f), "err", error.message);
  revalidatePath("/ops/stock");
  go(back(f), "msg", `Added ${qty} ${String(item.unit ?? "")} of ${String(item.name ?? "it")}.`.replace(/\s+/g, " "));
}

export async function countStock(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const qty = qtyOf(s(f, "qty"));
  if (!(qty >= 0)) go(back(f), "err", "Type what's really there (0 if none).");
  const { error } = await supabase.rpc("ops_stock_count", { p_stock: s(f, "id"), p_qty: qty, p_note: s(f, "note").slice(0, 200) || null });
  if (error) go(back(f), "err", error.message);
  revalidatePath("/ops/stock");
  go(back(f), "msg", "Count saved.");
}

export async function moveStock(f: FormData) {
  const { supabase } = await requireOps(opsCan.dispatch);
  const to = place(s(f, "to"));
  const qty = qtyOf(s(f, "qty"));
  if (!to) go(back(f), "err", "Pick where it's going.");
  if (!(qty > 0)) go(back(f), "err", "Type how many to move.");
  const { error } = await supabase.rpc("ops_stock_move", { p_stock: s(f, "id"), p_to_kind: to!.kind, p_to: to!.id, p_qty: qty });
  if (error) go(back(f), "err", error.message);
  revalidatePath("/ops/stock");
  go(back(f), "msg", "Moved.");
}

export async function setReorder(f: FormData) {
  const { supabase, ws } = await requireOps(opsCan.dispatch);
  const key = s(f, "item_key").toUpperCase();
  const qty = qtyOf(s(f, "min") || "0");
  if (!key) go(back(f), "err", "Pick the item.");
  if (!(qty >= 0)) go(back(f), "err", "Type a number (0 turns it off).");
  const { error } = qty > 0
    ? await supabase.from("ops_stock_min").upsert({ company_id: ws.company.id, item_key: key, product_id: s(f, "product_id") || null, name: s(f, "name").slice(0, 160) || key, unit: s(f, "unit").slice(0, 20) || "each", min_qty: qty })
    : await supabase.from("ops_stock_min").delete().eq("company_id", ws.company.id).eq("item_key", key);
  if (error) go(back(f), "err", error.message);
  revalidatePath("/ops/stock");
  go(back(f), "msg", qty > 0 ? "Reorder point saved." : "Reorder point turned off.");
}
