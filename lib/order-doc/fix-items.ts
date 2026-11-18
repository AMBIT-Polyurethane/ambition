import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FixItem, FixLot } from "@/components/loaded-fix";

type It = { id: number; sku: string; name: string; unit: string; qty: number | string; product_id: string | null };
type Ln = { order_item_id: number | null; qty: number | string; lot_id: number | null };

/**
 * "Fix what went out" for a picked-up / shipped order (admins): every spray foam item counted by lot, with every lot
 * at the location it could have come from. Items with nothing recorded (older orders) are in too (0083): their whole
 * amount goes on the lots you enter.
 */
export async function loadFixItems(supabase: SupabaseClient, items: It[], lines: Ln[]): Promise<FixItem[]> {
  const out = await Promise.all(
    items.map(async (it): Promise<FixItem | null> => {
      const done = lines.filter((l) => l.order_item_id === it.id);
      if (!done.length && !it.product_id) return null;
      const { data, error } = await supabase.rpc("order_item_lot_options", { p_item: it.id });
      if (error || !data?.length) return null;
      const opts = (data as FixLot[]).map((o) => ({ ...o, remaining: Number(o.remaining), mine: Number(o.mine) }));
      // Spray foam by lot only (fiberglass and supplies counted by total are fixed with Edit order).
      if (!done.some((l) => l.lot_id) && !opts.some((x) => x.same_type && !x.by_total)) return null;
      const recorded = done.reduce((t, l) => t + Number(l.qty), 0);
      return {
        item: it.id,
        name: it.name,
        sku: it.sku,
        unit: it.unit,
        total: recorded || Number(it.qty),
        recorded,
        noLot: recorded ? done.filter((l) => !l.lot_id).reduce((t, l) => t + Number(l.qty), 0) : Number(it.qty),
        options: opts,
      };
    }),
  );
  return out.filter((x): x is FixItem => x !== null);
}
