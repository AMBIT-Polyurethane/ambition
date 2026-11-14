"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { canPrice, type PriceEdit } from "@/lib/prices";

const nice = (e: { message?: string } | null) => (e?.message ?? "Something went wrong.").replace(/^.*?ERROR:\s*/, "");

/** Save changed customer prices (a blank price removes it). From the customer's price list or the master sheet. */
export async function savePrices(items: PriceEdit[], source: "manual" | "import" | "netsuite" = "manual", ref?: string): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s?.profile || !canPrice(s.profile)) return { ok: false, error: "Only admins and price approvers change customer prices." };
  const clean = items
    .filter((i) => i.company_id && i.product_id)
    .map((i) => {
      const t = (i.price ?? "").toString().replace(/[$,\s]/g, "");
      return { ...i, price: t === "" ? null : t };
    });
  const bad = clean.find((i) => i.price !== null && !/^\d*\.?\d+$/.test(i.price));
  if (bad) return { ok: false, error: `"${bad.price}" isn't a price. Type a number like 2.45.` };
  let saved = 0;
  // In chunks so a big spreadsheet doesn't time out.
  for (let i = 0; i < clean.length; i += 500) {
    const { data, error } = await s.supabase.rpc("customer_prices_save", { p_items: clean.slice(i, i + 500), p_source: source, p_ref: ref ?? null });
    if (error) return { ok: false, error: `${nice(error)}${saved ? ` (${saved} were saved first)` : ""}` };
    saved += Number(data ?? 0);
  }
  revalidatePath("/prices");
  for (const c of new Set(clean.map((i) => i.company_id))) revalidatePath(`/customers/${c}/prices`);
  return { ok: true, saved };
}
