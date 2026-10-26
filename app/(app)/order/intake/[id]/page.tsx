import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/session";
import { DraftReview, type DraftView, type PickProduct } from "@/components/intake/draft-review";
import { ORDER_CUSTOMER_COLUMNS, type OrderCustomer } from "@/lib/customers";
import type { CustomerMatch } from "@/lib/intake/read";
import type { Branch } from "@/lib/types";

export const metadata = { title: "Check the order" };
export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requirePerm("ordering");
  const { data: d } = await supabase.from("order_drafts").select("*").eq("id", id).maybeSingle();
  if (!d) notFound();

  const [{ data: prods }, { data: comps }, { data: branchRows }] = await Promise.all([
    supabase.from("products").select("id, sku, name, unit, sqft_per_unit").eq("active", true).order("sort").order("name"),
    supabase.from("companies").select(ORDER_CUSTOMER_COLUMNS).eq("active", true).order("name"),
    supabase.from("branches").select("*").eq("active", true).order("sort"),
  ]);
  const companies = (comps ?? []) as OrderCustomer[];
  const photos = ((d.images ?? []) as string[]).length
    ? ((await supabase.storage.from("photos").createSignedUrls(d.images as string[], 60 * 60)).data ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u)
    : [];

  // Other customers it could be, for one-tap switching.
  const suggestions = ((d.matches ?? []) as CustomerMatch[]).filter((m) => companies.some((c) => c.id === m.id));

  const draft: DraftView = {
    id: d.id,
    status: d.status,
    source_text: d.source_text,
    photos,
    customer_text: d.customer_text,
    company_id: d.company_id,
    branch_id: d.branch_id,
    delivery_method: d.delivery_method,
    ship_address: d.ship_address,
    po_number: d.po_number,
    needed_by: d.needed_by,
    notes: d.notes,
    items: d.items ?? [],
    questions: d.questions,
    order_id: d.order_id,
    created_by_name: d.created_by_name,
    created_at: d.created_at,
  };

  return (
    <DraftReview
      draft={draft}
      products={(prods ?? []) as PickProduct[]}
      companies={companies}
      branches={(branchRows ?? []) as Branch[]}
      suggestions={suggestions.slice(0, 4)}
    />
  );
}
