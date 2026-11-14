import { can } from "@/lib/access";
import type { Profile } from "@/lib/types";

// Customer prices: what each customer pays for each item. Set here by hand, from an approved price request,
// in bulk from a spreadsheet, and later from NetSuite.

export type Basis = "unit" | "lb" | "sqft";
export type PriceItem = { id: string; sku: string; name: string; unit: string; category_id: string | null; list_price: number | null; sqft_per_unit: number | null };
export type CustPrice = { company_id: string; product_id: string; price: number; basis: Basis; effective_on: string; expires_on: string | null; source: string; source_ref: string | null; note: string | null; updated_by_name: string | null; updated_at: string };
export type PriceEdit = { company_id: string; product_id: string; price: string | null; basis: Basis; effective_on?: string | null; expires_on?: string | null; note?: string | null };

/** Admins and anyone who approves price requests. */
export const canPrice = (p: Pick<Profile, "role" | "status"> & { perms?: string[] | null }) => can(p, "prf_approve");

/** Foam is quoted per lb, fiberglass per sq ft, everything else per unit. */
export function basisFor(p: Pick<PriceItem, "category_id">): Basis {
  if (p.category_id === "ambit-foam") return "lb";
  if (p.category_id === "batts") return "sqft";
  return "unit";
}

/** Pounds in a drum, from its name ("… 450 lb drum"). */
export function drumLbs(name: string): number | null {
  const m = /(\d{2,4})\s*(?:lb|lbs)\b/i.exec(name);
  return m ? Number(m[1]) : null;
}

/** What one unit (a drum, a bag) costs at this price. */
export function perUnit(price: number, basis: Basis, p: Pick<PriceItem, "name" | "sqft_per_unit">): number | null {
  if (basis === "unit") return price;
  if (basis === "lb") { const lb = drumLbs(p.name); return lb ? price * lb : null; }
  return p.sqft_per_unit ? price * Number(p.sqft_per_unit) : null;
}

export const BASIS_LABEL: Record<Basis, string> = { unit: "per unit", lb: "per lb", sqft: "per sq ft" };
export const SOURCE_LABEL: Record<string, string> = { manual: "Typed in", price_request: "Price request", import: "Spreadsheet", netsuite: "NetSuite", removed: "Removed" };

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
