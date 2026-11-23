import { qtyText } from "@/lib/format";

// Editing an order (0041): what changed, in words, for the order page, the order desk and the emails.

/** A quantity change, or (kind "price", 0105) an admin's price change on a finished order: from/to are prices each. */
export type OrderChange = { sku: string; name: string; unit: string; from: number | null; to: number | null; kind?: "price" };

export type OrderEdit = {
  id: number;
  revision: number;
  edited_by_name: string | null;
  edited_at: string;
  stage_before: string | null;
  changes: OrderChange[];
  total_before: number | null;
  note: string | null;
  invoice_updated_at: string | null;
  invoice_updated_by_name: string | null;
  total_after: number | null;
  credit_reopened: boolean | null;
  /** 0075: every change waits for an admin, who makes sure the QuickBooks invoice has it. */
  admin_needed?: boolean | null;
  admin_approved_at?: string | null;
  admin_approved_by_name?: string | null;
  admin_note?: string | null;
  admin_emailed_at?: string | null;
  admin_email_status?: string | null;
};

/** A change no admin has approved yet (0075). */
export const changeWaiting = (e: Pick<OrderEdit, "admin_needed" | "admin_approved_at">) => Boolean(e.admin_needed) && !e.admin_approved_at;

/** "Added 4 drums AMBI-SEAL 5.0", "AMBI-TITE 204: 10 drums → 12 drums", "Removed B7700 (was 20 bags)". */
export function changeText(c: OrderChange): string {
  if (c.kind === "price") {
    const usd = (v: number | null) => (v === null || v === undefined ? "no price" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" }));
    return `${c.name}: ${usd(c.from)} → ${usd(c.to)} each`;
  }
  const from = Number(c.from);
  const to = Number(c.to);
  if (from === 0) return `Added ${qtyText(to, c.unit)} ${c.name}`;
  if (to === 0) return `Removed ${c.name} (was ${qtyText(from, c.unit)})`;
  return `${c.name}: ${qtyText(from, c.unit)} → ${qtyText(to, c.unit)}`;
}

export const changesText = (list: OrderChange[] | null | undefined) => (list ?? []).map(changeText);

/** Orders that can still be edited: not completed or cancelled. */
export const editable = (o: { status: string }) => o.status !== "completed" && o.status !== "cancelled";

// ------------------------------------------------------------------ order details (0076)
/** One detail changed on an order: "Ship to: 12 Main St → 400 Oak Ave". */
export type DetailChange = { label: string; from: string | null; to: string | null };

export type DetailEdit = {
  id: number;
  changed_by_name: string | null;
  changed_at: string;
  changes: DetailChange[];
  note: string | null;
  restocked: boolean;
};

const short = (v: string | null | undefined, max = 120) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim() || "(none)";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
export const detailText = (c: DetailChange) => `${c.label}: ${short(c.from)} → ${short(c.to)}`;
export const detailsText = (list: DetailChange[] | null | undefined) => (Array.isArray(list) ? list : []).map(detailText);
