import { notFound } from "next/navigation";
import { isExpenseApprover, requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { claudeReady } from "@/lib/ai/claude";
import { todayCentral } from "@/lib/sale";
import { CHARGE_COLS, RECEIPT_COLS, RECEIPT_COLS_0050, chargeLabel, missing0062, monthLabel, type XCharge, type XReceipt } from "@/lib/expenses";
import { inventoryBranches } from "@/lib/widgets";
import { receiptInventory } from "@/app/(app)/expenses/actions";
import type { BuyDone, BuyState } from "@/components/expenses/buy-inventory";
import { ReceiptForm, type MiniCustomer } from "@/components/expenses/receipt-form";

export const metadata = { title: "Add a receipt" };
export const dynamic = "force-dynamic";

// Add a receipt (?charge= : for that card charge, &lost=1 : no photo), or fix one (?id=).
export default async function AddReceiptPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const uuid = /^[0-9a-f-]{36}$/i;

  // Before migration 0062 the newer columns aren't there: fall back to the older ones.
  const receiptBy = (cols: string) => supabase.from("expense_receipts").select(cols).eq("id", sp.id!).is("deleted_at", null).maybeSingle();
  const companiesBy = (cols: string) => supabase.from("companies").select(cols).eq("active", true).order("name").range(0, 9999);
  const [rec0, chg, cos0, cards, warehouses] = await Promise.all([
    sp.id && uuid.test(sp.id) ? receiptBy(RECEIPT_COLS) : Promise.resolve({ data: null, error: null }),
    sp.charge && uuid.test(sp.charge) ? supabase.from("expense_charges").select(CHARGE_COLS).eq("id", sp.charge).maybeSingle() : Promise.resolve({ data: null }),
    companiesBy("id, name, city, state, distributor"),
    supabase.from("expense_cards").select("last4").eq("user_id", profile.id).limit(1),
    inventoryBranches(supabase, profile, { all: true }),
  ]);
  const rec = rec0.error && missing0062(rec0.error) ? await receiptBy(RECEIPT_COLS_0050) : rec0;
  const cos = cos0.error && missing0062(cos0.error) ? await companiesBy("id, name, city, state") : cos0;
  const receipt = (rec.data as unknown as XReceipt | null) ?? null;
  if (sp.id && !receipt) notFound();
  const charge = (chg.data as XCharge | null) ?? null;
  if (sp.charge && !charge) notFound();
  const { data: on } = receipt ? await supabase.from("expense_charges").select(CHARGE_COLS).eq("receipt_id", receipt.id).maybeSingle() : { data: null };
  const matched = (on as XCharge | null) ?? null;
  const customers = ((cos.data ?? []) as unknown as { id: string; name: string; city: string | null; state: string | null; distributor?: boolean }[]).map(
    (c): MiniCustomer => (c.distributor ? [c.id, c.name, c.city, c.state, true] : [c.id, c.name, c.city, c.state]),
  );

  // Inventory already made from this receipt (0062): edit it while it waits, or show it's in stock.
  const inv = receipt?.inbound_id ? await receiptInventory(receipt.inbound_id) : null;
  const live = inv && inv.status !== "cancelled" ? inv : null;
  const buyDone: BuyDone = live && receipt?.inbound_id ? { id: receipt.inbound_id, status: live.status, branch: live.branch, expected: live.expected } : null;
  const buyStart: BuyState | null = live
    ? {
        branch: live.branch,
        mode: live.status === "expected" ? "shipped" : "picked_up",
        expected: live.expected,
        lines: live.lines.map((l) => ({ id: l.product_id, sku: l.sku, name: l.name, unit: l.unit, lot: Boolean(l.lot_no), qty: String(l.qty), lot_no: l.lot_no ?? "" })),
      }
    : profile.branch_id && warehouses.some((w) => w.id === profile.branch_id)
      ? { branch: profile.branch_id, mode: "", expected: "", lines: [] }
      : null;

  // A month that's waiting for approval or approved can't change (approvers can still fix things).
  let readOnly: string | null = null;
  const day = receipt?.bought_on ?? charge?.txn_date ?? null;
  if (day && !isExpenseApprover(profile)) {
    const { data: rep } = await supabase.from("expense_reports").select("status").eq("user_id", receipt?.user_id ?? profile.id).eq("month", `${day.slice(0, 7)}-01`).maybeSingle();
    if (rep?.status === "submitted") readOnly = `${monthLabel(day.slice(0, 7))} is waiting for approval, so its receipts are locked. If something needs fixing, ask an approver to send it back.`;
    if (rep?.status === "approved") readOnly = `${monthLabel(day.slice(0, 7))} is already approved, so its receipts can't change.`;
  }

  const back = sp.back && /^\/admin\/expenses\/review\?u=[0-9a-f-]{36}&m=\d{4}-\d{2}$/i.test(sp.back) ? sp.back : `/expenses${day ? `?m=${day.slice(0, 7)}` : ""}`;
  return (
    <main className="shell" style={{ gap: 14 }}>
      <TopBar title={receipt ? "Receipt" : sp.lost ? "Lost receipt" : "Add a receipt"} back={back} />
      <ReceiptForm
        uid={profile.id}
        today={todayCentral()}
        customers={customers}
        myCard={((cards.data ?? []) as { last4: string }[])[0]?.last4 ?? null}
        receipt={receipt ? { ...receipt, amount: Number(receipt.amount), tip: receipt.tip === null ? null : Number(receipt.tip) } : null}
        charge={charge && !receipt ? { id: charge.id, txn_date: charge.txn_date, label: chargeLabel(charge), amount: Number(charge.amount), card: charge.card_last4 } : null}
        lost={sp.lost === "1"}
        aiReady={claudeReady()}
        readOnly={readOnly}
        backHref={sp.back ? back : null}
        matched={matched ? { id: matched.id, txn_date: matched.txn_date, label: chargeLabel(matched), amount: Number(matched.amount), card: matched.card_last4 } : null}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        buyStart={buyStart}
        buyDone={buyDone}
      />
    </main>
  );
}
