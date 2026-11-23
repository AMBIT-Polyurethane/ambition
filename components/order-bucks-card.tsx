import { Gift, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { applyOrderBucks } from "@/app/(app)/orders/actions";
import { Submit } from "@/components/forms";
import { money } from "@/lib/format";

type Row = { points: number; kind: "earn" | "redeem" | "adjust"; note: string | null; created_by_name: string | null; created_at: string };

/**
 * Staff: AM-BUCKS on an AMBIT Intelligence order (0105). What it earned (3 points per $100 of invoice prices once
 * picked up or shipped out), what was used on it (off the invoice), and for the order desk a way to use the
 * customer's balance. Distributors never earn, so the card doesn't show for them.
 */
export async function OrderBucksCard({ orderId, companyId, canUse, status, subtotal, kind }: {
  orderId: string;
  companyId: string | null;
  canUse: boolean;
  status: string;
  subtotal: number;
  kind: string;
}) {
  if (!companyId || kind === "exchange") return null;
  const supabase = await createClient();
  const [{ data: co }, rowsRes, balRes, { data: set }] = await Promise.all([
    supabase.from("companies").select("distributor").eq("id", companyId).maybeSingle<{ distributor: boolean | null }>(),
    supabase.from("am_bucks_ledger").select("points, kind, note, created_by_name, created_at").eq("order_id", orderId).order("created_at"),
    supabase.rpc("am_bucks_company_balance", { p_company: companyId }),
    supabase.from("app_settings").select("value").eq("key", "am_bucks").maybeSingle<{ value: { points_per_dollar?: number; point_value?: number; orders_from?: string } }>(),
  ]);
  // Before the 0105 update (no order_id column yet) or a distributor: nothing to show.
  if (rowsRes.error || balRes.error || co?.distributor || !set?.value?.orders_from) return null;
  const rate = Number(set.value.points_per_dollar ?? 0.03);
  const pv = Number(set.value.point_value ?? 0.01);
  const rows = (rowsRes.data ?? []) as Row[];
  const earn = rows.find((r) => r.kind === "earn");
  const used = rows.filter((r) => r.kind === "redeem").reduce((s, r) => s - r.points, 0);
  const balance = Number(balRes.data ?? 0);
  const open = status !== "completed" && status !== "cancelled";
  const willEarn = open && kind === "sale" ? Math.floor(Math.max(0, subtotal) * rate) : 0;
  if (!earn && !used && balance <= 0 && !willEarn) return null;
  const usd = (pts: number) => money(Math.round(pts * pv * 100) / 100);
  return (
    <section className="card2" aria-label="AM-BUCKS">
      <div className="card2-h">
        <b style={{ whiteSpace: "nowrap" }}><Gift size={17} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> AM-BUCKS</b>
        <span className="up2-sub">Customer balance: <b>{balance} points ({usd(balance)})</b></span>
      </div>
      <div className="col" style={{ gap: 8, padding: "4px 16px 16px" }}>
        {earn ? (
          <span className="small">
            {earn.points >= 0 ? <>This order earned <b>{earn.points} points ({usd(earn.points)})</b>.</> : <>This return took back <b>{-earn.points} points ({usd(-earn.points)})</b>.</>}
          </span>
        ) : willEarn ? (
          <span className="small muted">Earns about {willEarn} points ({usd(willEarn)}) when it&apos;s {status === "new" ? "priced and " : ""}picked up or shipped out.</span>
        ) : null}
        {used > 0 ? (
          <div className="alert warn small" style={{ margin: 0 }}>
            <span>
              <b>{usd(used)}</b> in AM-BUCKS is on this order. Take it off the invoice in QuickBooks as a discount.
            </span>
            {canUse && status !== "cancelled" ? (
              <form action={applyOrderBucks} style={{ marginLeft: "auto" }}>
                <input type="hidden" name="id" value={orderId} />
                <input type="hidden" name="undo" value="1" />
                <Submit className="b2 quiet sm" pendingText="Taking off…"><Undo2 size={15} /> Take off</Submit>
              </form>
            ) : null}
          </div>
        ) : canUse && open && kind === "sale" && balance > 0 ? (
          <form action={applyOrderBucks} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <input type="hidden" name="id" value={orderId} />
            <label className="field" style={{ margin: 0 }}>
              <span className="label">Use on this order ($)</span>
              <input className="input sm" name="amount" inputMode="decimal" defaultValue={(balance * pv).toFixed(2)} style={{ width: 120 }} />
            </label>
            <Submit className="b2 sm" pendingText="Saving…">Use AM-BUCKS</Submit>
            <span className="tiny faint" style={{ flexBasis: "100%" }}>Only when the customer asks. It comes off their balance now; take the same amount off the invoice.</span>
          </form>
        ) : null}
      </div>
    </section>
  );
}
