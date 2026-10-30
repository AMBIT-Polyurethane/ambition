import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateTime, money, orderNo, qtyText } from "@/lib/format";
import { restoreDeleted } from "@/app/(app)/orders/actions";

export const metadata = { title: "Deleted orders" };
export const dynamic = "force-dynamic";

type Item = { name: string; sku: string | null; qty: number; unit: string | null };
type Deleted = {
  id: string;
  order_id: string;
  order_no: number;
  company_name: string | null;
  placed_by_name: string | null;
  placed_at: string | null;
  status_before: string | null;
  cancel_reason: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  est_subtotal: number | null;
  deleted_at: string;
  deleted_by_name: string | null;
  restored_at: string | null;
  restored_by_name: string | null;
  items: Item[] | null;
};

/** Orders an admin deleted. Only the order keepers (Jeremiah) see this and can put one back. */
export default async function DeletedOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireEmployee();
  const { data: keeper, error: kErr } = await supabase.rpc("is_order_keeper");

  if (kErr || !keeper) {
    return (
      <main className="shell">
        <TopBar title="Deleted orders" back="/orders" />
        <div className="alert info small">
          {kErr ? "Run supabase/migrations/0034_order_delete_log.sql in Supabase first." : "Only Jeremiah can see deleted orders and put them back."}
        </div>
      </main>
    );
  }

  const { data } = await supabase
    .from("orders_deleted")
    .select(
      "id, order_id, order_no, company_name, placed_by_name, placed_at, status_before, cancel_reason, cancelled_by_name, cancelled_at, est_subtotal, deleted_at, deleted_by_name, restored_at, restored_by_name, items:snapshot->items",
    )
    .order("deleted_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Deleted[];
  const waiting = rows.filter((r) => !r.restored_at);
  const back = rows.filter((r) => r.restored_at);

  return (
    <main className="shell">
      <TopBar title="Deleted orders" back="/orders" />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {sp.err ? <div className="alert err small" role="alert">{sp.err}</div> : null}
      <p className="muted small" style={{ margin: 0 }}>
        When an admin deletes an order, it comes here instead of being erased. Put it back and it returns with the same order #, lines and lots.
        Only you can see this page.
      </p>

      {!waiting.length ? <div className="alert info small">No deleted orders waiting here.</div> : null}

      <div className="col" style={{ gap: 12 }}>
        {waiting.map((r) => (
          <section key={r.id} className="card col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ fontSize: 17 }}>{orderNo(r.order_no)}</b>
              <span className="grow">{r.company_name ?? "Customer"}</span>
              {r.est_subtotal ? <span className="small muted">{money(r.est_subtotal)} before foam pricing</span> : null}
            </div>
            <span className="small muted">
              Placed {r.placed_by_name ? `by ${r.placed_by_name} ` : ""}{dateTime(r.placed_at)}
            </span>
            <span className="small">
              <b>Deleted by {r.deleted_by_name ?? "an admin"}</b> · {dateTime(r.deleted_at)}
              {r.cancel_reason ? <> · cancelled for: “{r.cancel_reason}”</> : null}
            </span>
            {r.items?.length ? (
              <ul className="small" style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                {r.items.map((it, i) => (
                  <li key={i}>
                    {qtyText(Number(it.qty), it.unit ?? "")} · {it.name}
                    {it.sku ? <span className="faint"> ({it.sku})</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <form action={restoreDeleted}>
                <input type="hidden" name="log" value={r.id} />
                <input type="hidden" name="reopen" value="1" />
                <Submit className="btn sm" pendingText="Putting it back…">
                  <RotateCcw size={15} /> Put it back
                </Submit>
              </form>
              <form action={restoreDeleted}>
                <input type="hidden" name="log" value={r.id} />
                <input type="hidden" name="reopen" value="0" />
                <Submit className="btn sm dark" pendingText="Putting it back…">Put it back as cancelled</Submit>
              </form>
            </div>
            <span className="tiny faint">
              “Put it back” opens it again ({r.status_before === "processing" ? "Processing" : "New"}) and holds its stock again. “As cancelled” brings it back for the record only.
            </span>
          </section>
        ))}
      </div>

      {back.length ? (
        <section className="col" style={{ gap: 6 }}>
          <b className="small">Already put back</b>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {back.map((r) => (
              <li key={r.id}>
                <Link href={`/orders/${r.order_id}`}>{orderNo(r.order_no)}</Link> {r.company_name ?? ""} · deleted by {r.deleted_by_name ?? "an admin"} {dateTime(r.deleted_at)} · put back by{" "}
                {r.restored_by_name ?? "you"} {dateTime(r.restored_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
