import { can } from "@/lib/access";
import type { Profile } from "@/lib/types";

// Customer prices: what each customer pays for each item. Set here by hand, from an approved price request,
// in bulk from a spreadsheet, and later from NetSuite.

export type Basis = "unit" | "lb" | "sqft";
export type PriceItem = { id: string; sku: string; name: string; unit: string; category_id: string | null; list_price: number | null; sqft_per_unit: number | null; drum_lbs?: number | null };
export type CustPrice = { company_id: string; product_id: string; price: number; basis: Basis; effective_on: string; expires_on: string | null; source: string; source_ref: string | null; note: string | null; updated_by_name: string | null; updated_at: string };
export type PriceEdit = { company_id: string; product_id: string; price: string | null; basis: Basis; effective_on?: string | null; expires_on?: string | null; note?: string | null };

/** Admins, anyone who approves price requests, and anyone with the Customer prices permission (0106). */
export const canPrice = (p: Pick<Profile, "role" | "status"> & { perms?: string[] | null }) => can(p, "prf_approve") || can(p, "prices");

/** Foam is quoted per lb, fiberglass batts per sq ft (blow-in per bag), everything else per unit. */
export function basisFor(p: Pick<PriceItem, "category_id"> & { name?: string | null }): Basis {
  if (p.category_id === "ambit-foam") return "lb";
  // "fiberglass" in the live app ("batts" in older test data).
  if (p.category_id === "fiberglass" || p.category_id === "batts") return /jet ?stream|climate ?pro|blow|loose ?fill|\bl77\b|propink|insul ?safe/i.test(p.name ?? "") ? "unit" : "sqft";
  return "unit";
}

/** Pounds in a drum, from its name ("… 450 lb drum"). */
export function drumLbs(name: string): number | null {
  const m = /(\d{2,4})\s*(?:lb|lbs)\b/i.exec(name);
  return m ? Number(m[1]) : null;
}

/** Pounds in one drum: the product's own number (0106), else from its name. */
export const lbsOf = (p: Pick<PriceItem, "name"> & { drum_lbs?: number | null }) => (p.drum_lbs ? Number(p.drum_lbs) : drumLbs(p.name));

/** What one unit (a drum, a bag) costs at this price. */
export function perUnit(price: number, basis: Basis, p: Pick<PriceItem, "name" | "sqft_per_unit"> & { drum_lbs?: number | null }): number | null {
  if (basis === "unit") return price;
  if (basis === "lb") { const lb = lbsOf(p); return lb ? price * lb : null; }
  return p.sqft_per_unit ? price * Number(p.sqft_per_unit) : null;
}

/** A foam set is one resin drum and one 500 lb ISO drum: what the set costs at a $/lb price. */
export const setPrice = (lb: number, p: Pick<PriceItem, "name"> & { drum_lbs?: number | null }) => { const r = lbsOf(p); return r ? Math.round(lb * (r + 500) * 100) / 100 : null; };

/** A pending change from the pricing dashboard (0106). */
export type PendingChange = { batch_id: number; company_id: string | null; product_id: string; new_price: number; basis: Basis; effective_on: string };
export type PriceBatch = {
  id: number; label: string; method: "pct" | "add" | "set"; amount: number; effective_on: string; only_own: boolean;
  customers: number; products: number; changes: number; note: string | null; created_by_name: string | null; created_at: string;
  undone_at: string | null; undone_by_name: string | null;
};

export const BASIS_LABEL: Record<Basis, string> = { unit: "per unit", lb: "per lb", sqft: "per sq ft" };
export const SOURCE_LABEL: Record<string, string> = { manual: "Typed in", price_request: "Price request", import: "Spreadsheet", netsuite: "NetSuite", bulk: "Pricing dashboard", removed: "Removed" };

/** Supabase caps a read at 1,000 rows: page through. */
export async function allRows<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}
