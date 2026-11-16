import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { can } from "@/lib/access";

// Drums of a lot set aside for one customer (0071). The app won't give them to anyone else, and that customer's
// orders take them first. Holds end when the customer's orders have used them, when someone releases them, or on
// their date.

export type Hold = {
  id: number;
  lot_id: number;
  branch_id: string;
  sku: string;
  lot_no: string | null;
  company_id: string;
  company_name: string;
  qty: number;
  held_left: number;
  until: string;
  note: string | null;
  by_name: string | null;
  by_id: string | null;
  created_at: string;
  lot_remaining: number;
};

/** Admins and the order desk (CRMs) place and release holds. */
export const canHold = (p: Parameters<typeof can>[0]) => can(p, "order_desk");

/** The active holds at a location (null: every location). Empty before update 0071. */
export async function holdsAt(db: SupabaseClient, branch: string | null): Promise<Hold[]> {
  const { data, error } = await db.rpc("inventory_holds_at", { p_branch: branch });
  if (error || !data) return [];
  return (data as Hold[]).map((h) => ({ ...h, qty: Number(h.qty), held_left: Number(h.held_left), lot_remaining: Number(h.lot_remaining) }));
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** "ProSeal 6 until 12/16; Gulf Coast 2 until 1/5" (only what's still set aside). */
export const holdText = (list: Pick<Hold, "company_name" | "held_left" | "until">[]) =>
  list.filter((h) => h.held_left > 0).map((h) => `${h.company_name} ${n(h.held_left)} until ${md(h.until)}`).join("; ");

/** The FOAM LOTS Notes cell: the person's own notes, then "[HELD: …]" written by the app. */
const TAG = /\s*\[HELD:[^\]]*\]/gi;
export const stripHoldTag = (notes: string | null | undefined) => (notes ?? "").replace(TAG, "").trim();
export const withHoldTag = (notes: string | null | undefined, text: string) => {
  const own = stripHoldTag(notes);
  return text ? `${own}${own ? " " : ""}[HELD: ${text}]` : own;
};
