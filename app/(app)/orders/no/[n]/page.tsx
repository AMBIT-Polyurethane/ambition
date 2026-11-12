import { notFound, redirect } from "next/navigation";
import { requireActive } from "@/lib/session";

/** ORD-1401 written in chat (or anywhere): open that order. */
export default async function OrderByNumber({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  if (!/^\d{1,9}$/.test(n)) notFound();
  const { supabase } = await requireActive();
  const { data } = await supabase.from("orders").select("id").eq("order_no", Number(n)).maybeSingle();
  if (!data) notFound();
  redirect(`/orders/${data.id}`);
}
