import { notFound, redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { canEstimate } from "@/lib/access";
import { estNo, loadEstimate } from "@/lib/estimates";
import { estimateChoices } from "@/lib/estimates-server";
import { TopBar } from "@/components/ui";
import { EstimateForm } from "@/components/estimates/estimate-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Change estimate" };

export default async function EditEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireEmployee();
  if (!canEstimate(profile)) redirect("/");
  const d = await loadEstimate(supabase, id);
  if (!d) notFound();
  if (d.est.status === "converted" || d.est.status === "cancelled") redirect(`/estimates/${id}`);
  const { customers, products, branches } = await estimateChoices(supabase);
  const e = d.est;
  return (
    <main className="shell">
      <TopBar title={`Change ${estNo(e.est_no)}`} back={`/estimates/${id}`} />
      {e.status === "ready" || e.status === "sent" ? (
        <div className="alert warn small" style={{ marginBottom: 12 }}>
          <span>{e.delivery_method === "jobsite" ? "Changing a delivered estimate sends it back to the CRMs to check the freight." : "It's priced again at today's prices when you save."}</span>
        </div>
      ) : null}
      <EstimateForm
        customers={customers}
        products={products}
        branches={branches}
        initial={{
          id: e.id,
          est_no: e.est_no,
          company_id: e.company_id,
          delivery_method: e.delivery_method,
          branch_id: e.branch_id ?? "",
          ship_address: e.ship_address ?? "",
          ship_state: e.ship_state ?? "",
          ship_zip: e.ship_zip ?? "",
          customer_note: e.customer_note ?? "",
          staff_note: e.staff_note ?? "",
          items: d.items.filter((i) => i.product_id).map((i) => ({ product_id: i.product_id!, qty: i.qty })),
        }}
      />
    </main>
  );
}
