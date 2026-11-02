import { qtyText } from "@/lib/format";

// Editing an order (0041): what changed, in words, for the order page, the order desk and the emails.

export type OrderChange = { sku: string; name: string; unit: string; from: number; to: number };

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
};

/** "Added 4 drums AMBI-SEAL 5.0", "AMBI-TITE 204: 10 drums → 12 drums", "Removed B7700 (was 20 bags)". */
export function changeText(c: OrderChange): string {
  const from = Number(c.from);
  const to = Number(c.to);
  if (from === 0) return `Added ${qtyText(to, c.unit)} ${c.name}`;
  if (to === 0) return `Removed ${c.name} (was ${qtyText(from, c.unit)})`;
  return `${c.name}: ${qtyText(from, c.unit)} → ${qtyText(to, c.unit)}`;
}

export const changesText = (list: OrderChange[] | null | undefined) => (list ?? []).map(changeText);

/** Orders that can still be edited: not completed or cancelled. */
export const editable = (o: { status: string }) => o.status !== "completed" && o.status !== "cancelled";
