import { notFound } from "next/navigation";
import { isExpenseApprover, requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { claudeReady } from "@/lib/ai/claude";
import { todayCentral } from "@/lib/sale";
import { CHARGE_COLS, RECEIPT_COLS, chargeLabel, monthLabel, type XCharge, type XReceipt } from "@/lib/expenses";
import { ReceiptForm, type MiniCustomer } from "@/components/expenses/receipt-form";

export const metadata = { title: "Add a receipt" };
export const dynamic = "force-dynamic";

// Add a receipt (?charge= : for that card charge, &lost=1 : no photo), or fix one (?id=).
export default async function AddReceiptPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const uuid = /^[0-9a-f-]{36}$/i;

  const [rec, chg, cos, cards] = await Promise.all([
    sp.id && uuid.test(sp.id) ? supabase.from("expense_receipts").select(RECEIPT_COLS).eq("id", sp.id).is("deleted_at", null).maybeSingle() : Promise.resolve({ data: null }),
    sp.charge && uuid.test(sp.charge) ? supabase.from("expense_charges").select(CHARGE_COLS).eq("id", sp.charge).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("companies").select("id, name, city, state").eq("active", true).order("name").range(0, 9999),
    supabase.from("expense_cards").select("last4").eq("user_id", profile.id).limit(1),
  ]);
  const receipt = (rec.data as XReceipt | null) ?? null;
  if (sp.id && !receipt) notFound();
  const charge = (chg.data as XCharge | null) ?? null;
  if (sp.charge && !charge) notFound();
  const { data: on } = receipt ? await supabase.from("expense_charges").select(CHARGE_COLS).eq("receipt_id", receipt.id).maybeSingle() : { data: null };
  const matched = (on as XCharge | null) ?? null;
  const customers = ((cos.data ?? []) as { id: string; name: string; city: string | null; state: string | null }[]).map((c): MiniCustomer => [c.id, c.name, c.city, c.state]);

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
      />
    </main>
  );
}
