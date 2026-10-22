import type { Company } from "@/lib/types";

/** What the order screen needs to know about a customer. */
export type OrderCustomer = Pick<
  Company,
  | "id"
  | "name"
  | "account_no"
  | "default_branch_id"
  | "contact_name"
  | "phone"
  | "email"
  | "city"
  | "state"
  | "bill_address"
  | "ship_address"
  | "needs_qb_setup"
>;

export const ORDER_CUSTOMER_COLUMNS =
  "id, name, account_no, default_branch_id, contact_name, phone, email, city, state, bill_address, ship_address, needs_qb_setup";

/** The address an order ships to unless someone changes it. */
export const addressOnFile = (c: Pick<Company, "ship_address" | "bill_address"> | null | undefined) =>
  (c?.ship_address || c?.bill_address || "").trim();

/** Every word typed must appear somewhere in the customer's name, account #, contact or city. */
export function matchCustomers<T extends OrderCustomer>(list: T[], query: string, limit = 50): { shown: T[]; more: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { shown: list.slice(0, limit), more: Math.max(0, list.length - limit) };
  const hits = list.filter((c) => {
    const hay = `${c.name} ${c.account_no ?? ""} ${c.contact_name ?? ""} ${c.city ?? ""} ${c.state ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const first = words[0];
  hits.sort((a, b) => {
    const as = a.name.toLowerCase().startsWith(first) ? 0 : 1;
    const bs = b.name.toLowerCase().startsWith(first) ? 0 : 1;
    return as - bs || a.name.localeCompare(b.name);
  });
  return { shown: hits.slice(0, limit), more: Math.max(0, hits.length - limit) };
}
