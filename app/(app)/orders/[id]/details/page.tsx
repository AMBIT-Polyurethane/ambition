import { redirect } from "next/navigation";

/** The details are part of Edit order now (one Save for everything). Old links land on that tab. */
export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orders/${id}/edit?tab=details`);
}
