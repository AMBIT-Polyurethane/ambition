import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AdcOrderRow = {
  id: number;
  no: string;
  at: string;
  status: string;
  delivery: string;
  items: { product_id: string | null; sku: string; name: string; qty: number; price: number | null; set?: boolean }[];
  subtotal: number;
  has_quote: boolean;
  paid_total: number | null;
  points: number | null;
};
export type AdcAccount = {
  email: string;
  verified: boolean;
  web_only: boolean;
  account: { name: string | null; company: string | null; phone: string | null; street: string | null; city: string | null; state: string | null; zip: string | null; promo_opt_in: boolean } | null;
  points: number;
  point_value: number;
  points_per_dollar: number;
  history: { at: string; points: number; kind: string; note: string | null }[];
  orders: AdcOrderRow[];
};

/** The signed-in shopper's ADC account (null: not signed in, or a partner store's login). */
export const adcAccount = cache(async (): Promise<AdcAccount | null> => {
  const supabase = await createClient();
  const { data: c } = await supabase.auth.getClaims();
  if (!c?.claims?.sub) return null;
  const { data, error } = await supabase.rpc("adc_my_account");
  if (error || !data) return null;
  const a = data as AdcAccount;
  return {
    ...a,
    points: Number(a.points) || 0,
    point_value: Number(a.point_value) || 0.01,
    orders: (a.orders ?? []).map((o) => ({ ...o, subtotal: Number(o.subtotal), paid_total: o.paid_total === null ? null : Number(o.paid_total) })),
  };
});
