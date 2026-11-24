import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/prices";
import type { EstBranch, EstCustomer, EstProduct } from "@/components/estimates/estimate-form";

/** What the estimate form picks from: active customers, active items, AMBIT locations. */
export async function estimateChoices(db: SupabaseClient): Promise<{ customers: EstCustomer[]; products: EstProduct[]; branches: EstBranch[] }> {
  const [customers, products, { data: branches }] = await Promise.all([
    allRows<EstCustomer>((f, t) => db.from("companies").select("id, name, account_no, city, state, default_branch_id").eq("active", true).order("name").range(f, t)),
    allRows<EstProduct>((f, t) => db.from("products").select("id, sku, name, unit, category_id").eq("active", true).order("sort").order("name").range(f, t)),
    db.from("branches").select("id, name, state").eq("active", true).order("sort"),
  ]);
  return { customers, products, branches: (branches ?? []) as EstBranch[] };
}
